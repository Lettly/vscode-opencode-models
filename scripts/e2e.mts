// Exercises the packaged bundle against a live OpenCode v2 service with a
// stubbed VS Code API. Not part of the VSIX; run with `npx tsx scripts/e2e.mts`.
import Module from "node:module"

class LanguageModelTextPart {
  constructor(readonly value: string) {}
}
class LanguageModelToolCallPart {
  constructor(
    readonly callId: string,
    readonly name: string,
    readonly input: object,
  ) {}
}
class LanguageModelToolResultPart {
  constructor(
    readonly callId: string,
    readonly content: unknown[],
  ) {}
}
class LanguageModelDataPart {
  constructor(
    readonly data: Uint8Array,
    readonly mimeType: string,
  ) {}
}
class EventEmitter<T> {
  private listeners: Array<(value: T) => void> = []
  readonly event = (listener: (value: T) => void) => {
    this.listeners.push(listener)
    return { dispose: () => {} }
  }
  fire(value: T): void {
    for (const listener of this.listeners) listener(value)
  }
  dispose(): void {}
}

const noop = (): void => {}

const vscode = {
  EventEmitter,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelDataPart,
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  Uri: { parse: (value: string) => ({ value }) },
  env: { openExternal: noop },
  commands: { registerCommand: () => ({ dispose: noop }), executeCommand: noop },
  window: {
    createOutputChannel: () => ({
      info: (...args: unknown[]) => console.log("LOG", ...args),
      warn: (...args: unknown[]) => console.log("LOG-WARN", ...args),
      error: (...args: unknown[]) => console.log("LOG-ERROR", ...args),
      show: noop,
      dispose: noop,
    }),
    showWarningMessage: (message: string) => console.error("WARN", message),
    showErrorMessage: (message: string) => console.error("ERROR", message),
    showInformationMessage: noop,
    showQuickPick: async () => undefined,
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => (key === "command" ? "opencode" : fallback),
    }),
    onDidChangeConfiguration: () => ({ dispose: noop }),
  },
  lm: {
    registerLanguageModelChatProvider: (_vendor: string, provider: unknown) => {
      captured = provider
      return { dispose: noop }
    },
  },
}

let captured: any

const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }
const original = loader._load
loader._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "vscode") return vscode
  return original.call(this, request, parent, isMain)
}

const extension = await import("../dist/extension.cjs")
extension.activate({ subscriptions: [] })
if (!captured) throw new Error("provider was not registered")

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: noop }) }
const models = await captured.provideLanguageModelChatInformation({ silent: false }, token)
console.log("MODELS", models.length)

const candidates = models.filter((m: any) => m.capabilities.toolCalling)
if (candidates.length === 0) throw new Error("no tool-capable model available")

let succeeded = false
for (const model of candidates) {
  const parts: Array<Record<string, unknown>> = []
  try {
    await captured.provideLanguageModelChatResponse(
      model,
      [{ role: 1, name: undefined, content: [new LanguageModelTextPart("Call the ping tool with value 5. No prose.")] }],
      {
        toolMode: 1,
        tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object", properties: { value: { type: "number" } } } }],
      },
      { report: (part: unknown) => parts.push({ type: (part as any).constructor.name, part }) },
      token,
    )
  } catch (error) {
    console.log("SKIP", model.id, error instanceof Error ? error.message.slice(0, 80) : error)
    continue
  }

  console.log(
    "RESULT",
    model.id,
    JSON.stringify(
      parts.map((entry) =>
        entry.type === "LanguageModelToolCallPart"
          ? { type: entry.type, name: (entry.part as any).name, input: (entry.part as any).input }
          : { type: entry.type, value: (entry.part as any).value },
      ),
    ),
  )
  succeeded = true
  break
}

if (!succeeded) throw new Error("every tool-capable model failed")
