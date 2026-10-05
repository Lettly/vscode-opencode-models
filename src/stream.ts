export interface StreamHandler {
  onText(delta: string): void
  onToolCall(id: string, name: string, input: unknown): void
}

export class ProviderRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ProviderRequestError"
  }
}

export function joinURL(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

export function parseToolArguments(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === "") return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return {}
  }
}
