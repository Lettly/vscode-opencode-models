import assert from "node:assert/strict"
import test from "node:test"
import {
  serializeTranscript,
  toAnthropicMessages,
  toOpenAIMessages,
  type MessageDescriptor,
} from "../src/convert.js"

test("maps a tool call and its result to OpenAI messages", () => {
  const messages: MessageDescriptor[] = [
    { role: "user", parts: [{ kind: "text", text: "ping" }] },
    { role: "assistant", parts: [{ kind: "tool-call", id: "call_1", name: "ping", input: { value: 7 } }] },
    { role: "user", parts: [{ kind: "tool-result", id: "call_1", text: "ok" }] },
  ]

  assert.deepEqual(toOpenAIMessages(messages), [
    { role: "user", content: "ping" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "ping", arguments: '{"value":7}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: "ok" },
  ])
})

test("embeds images as data URLs for OpenAI", () => {
  const messages: MessageDescriptor[] = [
    { role: "user", parts: [{ kind: "text", text: "look" }, { kind: "image", mime: "image/png", base64: "AAA" }] },
  ]
  const [message] = toOpenAIMessages(messages)
  assert.deepEqual(message?.content, [
    { type: "text", text: "look" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
  ])
})

test("merges consecutive same-role messages for Anthropic", () => {
  const messages: MessageDescriptor[] = [
    { role: "user", parts: [{ kind: "text", text: "one" }] },
    { role: "user", parts: [{ kind: "text", text: "two" }] },
  ]
  assert.deepEqual(toAnthropicMessages(messages), [
    { role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] },
  ])
})

test("serializes a transcript with role labels", () => {
  const prompt = serializeTranscript([
    { role: "user", parts: [{ kind: "text", text: "Hi" }] },
    { role: "assistant", parts: [{ kind: "text", text: "Hello" }] },
  ])
  assert.match(prompt, /USER:\nHi/)
  assert.match(prompt, /ASSISTANT:\nHello/)
  assert.match(prompt, /ASSISTANT:\s*$/)
})
