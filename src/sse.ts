export interface ServerSentEvent {
  event: string | undefined
  data: string
}

/**
 * Minimal Server-Sent Events reader. Yields one event per blank-line-delimited
 * block, joining multi-line `data:` fields with newlines and ignoring comments.
 */
export async function* readServerSentEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let eventName: string | undefined
  const dataLines: string[] = []

  const flush = (): ServerSentEvent | undefined => {
    if (eventName === undefined && dataLines.length === 0) return undefined
    const result: ServerSentEvent = { event: eventName, data: dataLines.join("\n") }
    eventName = undefined
    dataLines.length = 0
    return result
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "")
        buffer = buffer.slice(newline + 1)

        if (line === "") {
          const flushed = flush()
          if (flushed) yield flushed
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":")
          const field = colon === -1 ? line : line.slice(0, colon)
          const raw = colon === -1 ? "" : line.slice(colon + 1)
          const value2 = raw.startsWith(" ") ? raw.slice(1) : raw
          if (field === "event") eventName = value2
          else if (field === "data") dataLines.push(value2)
        }
        newline = buffer.indexOf("\n")
      }
    }
    const flushed = flush()
    if (flushed) yield flushed
  } finally {
    reader.releaseLock()
  }
}
