export type PartDescriptor =
  | { kind: "text"; text: string }
  | { kind: "image"; mime: string; base64: string }
  | { kind: "tool-call"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; id: string; text: string }

export interface MessageDescriptor {
  role: "user" | "assistant"
  parts: PartDescriptor[]
}

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: object | undefined
}

export type ToolChoice = "auto" | "required"

export interface OpenAITextContent {
  type: "text"
  text: string
}
export interface OpenAIImageContent {
  type: "image_url"
  image_url: { url: string }
}
export type OpenAIContent = OpenAITextContent | OpenAIImageContent

export interface OpenAIToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface OpenAIMessage {
  role: "user" | "assistant" | "tool"
  content: string | OpenAIContent[] | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAITool {
  type: "function"
  function: { name: string; description: string; parameters: object | undefined }
}

export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }

export interface AnthropicMessage {
  role: "user" | "assistant"
  content: AnthropicBlock[]
}

export interface AnthropicTool {
  name: string
  description: string
  input_schema: object | undefined
}

const textOf = (parts: readonly PartDescriptor[]): string =>
  parts
    .filter((part): part is Extract<PartDescriptor, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("")

const imagesOf = (parts: readonly PartDescriptor[]): Array<Extract<PartDescriptor, { kind: "image" }>> =>
  parts.filter((part): part is Extract<PartDescriptor, { kind: "image" }> => part.kind === "image")

const callsOf = (parts: readonly PartDescriptor[]): Array<Extract<PartDescriptor, { kind: "tool-call" }>> =>
  parts.filter((part): part is Extract<PartDescriptor, { kind: "tool-call" }> => part.kind === "tool-call")

const resultsOf = (parts: readonly PartDescriptor[]): Array<Extract<PartDescriptor, { kind: "tool-result" }>> =>
  parts.filter((part): part is Extract<PartDescriptor, { kind: "tool-result" }> => part.kind === "tool-result")

export function toOpenAIMessages(messages: readonly MessageDescriptor[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []

  for (const message of messages) {
    const text = textOf(message.parts)
    const images = imagesOf(message.parts)
    const calls = callsOf(message.parts)

    if (message.role === "assistant" && calls.length > 0) {
      out.push({
        role: "assistant",
        content: text.length > 0 ? text : null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
        })),
      })
    } else if (text.length > 0 || images.length > 0) {
      if (images.length === 0) {
        out.push({ role: message.role, content: text })
      } else {
        const content: OpenAIContent[] = []
        if (text.length > 0) content.push({ type: "text", text })
        for (const image of images) {
          content.push({ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}` } })
        }
        out.push({ role: message.role, content })
      }
    }

    for (const result of resultsOf(message.parts)) {
      out.push({ role: "tool", tool_call_id: result.id, content: result.text })
    }
  }

  return out
}

export function toOpenAITools(tools: readonly ToolDescriptor[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }))
}

export function toAnthropicMessages(messages: readonly MessageDescriptor[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []

  for (const message of messages) {
    const blocks: AnthropicBlock[] = []
    for (const part of message.parts) {
      if (part.kind === "text") blocks.push({ type: "text", text: part.text })
      else if (part.kind === "image") {
        blocks.push({ type: "image", source: { type: "base64", media_type: part.mime, data: part.base64 } })
      } else if (part.kind === "tool-call") {
        blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.input ?? {} })
      } else if (part.kind === "tool-result") {
        blocks.push({ type: "tool_result", tool_use_id: part.id, content: part.text })
      }
    }
    if (blocks.length === 0) continue
    const previous = out[out.length - 1]
    if (previous && previous.role === message.role) previous.content.push(...blocks)
    else out.push({ role: message.role, content: blocks })
  }

  return out
}

export function toAnthropicTools(tools: readonly ToolDescriptor[]): AnthropicTool[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
}

/**
 * Flatten a conversation into a single prompt for OpenCode's stateless
 * `experimental.generate` endpoint, which accepts only a prompt string.
 */
export function serializeTranscript(messages: readonly MessageDescriptor[]): string {
  const blocks: string[] = [
    "You are an assistant embedded in an editor. Continue the conversation and reply with the assistant's next message only. Do not include role labels.",
  ]

  for (const message of messages) {
    const lines: string[] = []
    const text = textOf(message.parts)
    if (text.length > 0) lines.push(text)
    for (const call of callsOf(message.parts)) {
      lines.push(`[tool call ${call.name}(${safeJson(call.input)})]`)
    }
    for (const result of resultsOf(message.parts)) {
      lines.push(`[tool result ${result.id}]: ${result.text}`)
    }
    if (imagesOf(message.parts).length > 0) lines.push("[image omitted]")
    if (lines.length === 0) continue
    blocks.push(`${message.role === "user" ? "USER" : "ASSISTANT"}:\n${lines.join("\n")}`)
  }

  blocks.push("ASSISTANT:")
  return blocks.join("\n\n")
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return "{}"
  }
}
