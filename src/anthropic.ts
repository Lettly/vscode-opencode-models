import { toAnthropicMessages, toAnthropicTools, type MessageDescriptor, type ToolChoice, type ToolDescriptor } from "./convert.js"
import { readServerSentEvents } from "./sse.js"
import { joinURL, parseToolArguments, ProviderRequestError, type StreamHandler } from "./stream.js"

export interface AnthropicRequest {
  baseURL: string
  apiKey: string | undefined
  model: string
  headers: Record<string, string> | undefined
  body: Record<string, unknown> | undefined
  messages: readonly MessageDescriptor[]
  tools: readonly ToolDescriptor[]
  toolChoice: ToolChoice
  maxOutputTokens: number
}

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

export async function streamAnthropicMessages(request: AnthropicRequest, handler: StreamHandler, signal: AbortSignal): Promise<void> {
  const body: Record<string, unknown> = {
    ...request.body,
    model: request.model,
    max_tokens: request.maxOutputTokens,
    messages: toAnthropicMessages(request.messages),
    stream: true,
  }
  if (request.tools.length > 0) {
    body.tools = toAnthropicTools(request.tools)
    body.tool_choice = request.toolChoice === "required" ? { type: "any" } : { type: "auto" }
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    ...request.headers,
  }
  if (request.apiKey) headers["x-api-key"] = request.apiKey

  const response = await fetch(joinURL(request.baseURL, "messages"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) throw new ProviderRequestError(response.status, await errorText(response))
  if (!response.body) throw new ProviderRequestError(response.status, "The provider returned an empty response body.")

  const calls = new Map<number, ToolCallAccumulator>()

  for await (const event of readServerSentEvents(response.body)) {
    if (event.data.length === 0) continue
    let payload: any
    try {
      payload = JSON.parse(event.data)
    } catch {
      continue
    }

    switch (payload.type) {
      case "content_block_start": {
        const block = payload.content_block
        if (block?.type === "tool_use") {
          calls.set(payload.index, { id: block.id ?? "", name: block.name ?? "", arguments: "" })
        }
        break
      }
      case "content_block_delta": {
        const delta = payload.delta
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          handler.onText(delta.text)
        } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const current = calls.get(payload.index)
          if (current) current.arguments += delta.partial_json
        }
        break
      }
      case "error": {
        throw new ProviderRequestError(200, payload.error?.message ?? "The provider reported an error mid-stream.")
      }
      default:
        break
    }
  }

  for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    if (call.name.length === 0) continue
    handler.onToolCall(call.id || `toolu_${index}`, call.name, parseToolArguments(call.arguments))
  }
}

async function errorText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.length > 0 ? text.slice(0, 2000) : `The provider returned HTTP ${response.status}.`
  } catch {
    return `The provider returned HTTP ${response.status}.`
  }
}
