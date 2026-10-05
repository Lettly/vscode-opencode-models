import assert from "node:assert/strict"
import test from "node:test"
import { readServerSentEvents, type ServerSentEvent } from "../src/sse.js"

async function collect(text: string): Promise<ServerSentEvent[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  const events: ServerSentEvent[] = []
  for await (const event of readServerSentEvents(stream)) events.push(event)
  return events
}

test("reads a single data event", async () => {
  assert.deepEqual(await collect("data: hello\n\n"), [{ event: undefined, data: "hello" }])
})

test("reads named events and joins multi-line data", async () => {
  assert.deepEqual(await collect("event: delta\ndata: a\ndata: b\n\n"), [{ event: "delta", data: "a\nb" }])
})

test("ignores comments and handles CRLF", async () => {
  assert.deepEqual(await collect(": ping\r\ndata: value\r\n\r\n"), [{ event: undefined, data: "value" }])
})

test("reads events split across chunks", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode("data: hel"))
      controller.enqueue(encoder.encode("lo\n\ndata: world\n\n"))
      controller.close()
    },
  })
  const events: ServerSentEvent[] = []
  for await (const event of readServerSentEvents(stream)) events.push(event)
  assert.deepEqual(events, [
    { event: undefined, data: "hello" },
    { event: undefined, data: "world" },
  ])
})
