import { toOpenAIMessages, toOpenAITools, type MessageDescriptor, type OpenAIMessage, type OpenAITool, type ToolChoice, type ToolDescriptor } from "./convert.js"
import { readServerSentEvents } from "./sse.js"
import { joinURL, parseToolArguments, ProviderRequestError, type StreamHandler } from "./stream.js"

export interface OpenAIRequest {
  baseURL: string
  apiKey: string | undefined
  model: string
  headers: Record<string, string> | undefined
  body: Record<string, unknown> | undefined
  messages: readonly MessageDescriptor[]
  tools: readonly ToolDescriptor[]
  toolChoice: ToolChoice
  maxOutputTokens: number | undefined
}

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

export async function streamOpenAIChat(request: OpenAIRequest, handler: StreamHandler, signal: AbortSignal): Promise<void> {
  const body: Record<string, unknown> = {
    ...request.body,
    model: request.model,
    stream: true,
    messages: toOpenAIMessages(request.messages) as OpenAIMessage[],
  }
  if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens
  if (request.tools.length > 0) {
    body.tools = toOpenAITools(request.tools) as OpenAITool[]
    body.tool_choice = request.toolChoice
  }

  const headers: Record<string, string> = { "content-type": "application/json", ...request.headers }
  if (request.apiKey) headers.authorization = `Bearer ${request.apiKey}`

  const response = await fetch(joinURL(request.baseURL, "chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) throw new ProviderRequestError(response.status, await errorText(response))
  if (!response.body) throw new ProviderRequestError(response.status, "The provider returned an empty response body.")

  const calls = new Map<number, ToolCallAccumulator>()
  let finish: string | undefined

  for await (const event of readServerSentEvents(response.body)) {
    if (event.data === "[DONE]") break
    let payload: any
    try {
      payload = JSON.parse(event.data)
    } catch {
      continue
    }

    const choice = payload?.choices?.[0]
    if (!choice) continue
    const delta = choice.delta
    if (typeof delta?.content === "string" && delta.content.length > 0) handler.onText(delta.content)

    if (Array.isArray(delta?.tool_calls)) {
      for (const raw of delta.tool_calls) {
        const index = typeof raw.index === "number" ? raw.index : calls.size
        const current = calls.get(index) ?? { id: "", name: "", arguments: "" }
        if (typeof raw.id === "string" && raw.id.length > 0) current.id = raw.id
        if (typeof raw.function?.name === "string" && raw.function.name.length > 0) current.name = raw.function.name
        if (typeof raw.function?.arguments === "string") current.arguments += raw.function.arguments
        calls.set(index, current)
      }
    }

    if (typeof choice.finish_reason === "string") finish = choice.finish_reason
  }

  if (finish === "error") throw new ProviderRequestError(200, "The provider ended the stream with an error.")

  for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    if (call.name.length === 0) continue
    handler.onToolCall(call.id || `call_${index}`, call.name, parseToolArguments(call.arguments))
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
