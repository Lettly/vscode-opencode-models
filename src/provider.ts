import * as vscode from "vscode"
import { streamAnthropicMessages } from "./anthropic.js"
import { loadCatalog, type CatalogModel } from "./catalog.js"
import {
  serializeTranscript,
  type MessageDescriptor,
  type PartDescriptor,
  type ToolChoice,
  type ToolDescriptor,
} from "./convert.js"
import { streamOpenAIChat } from "./openai.js"
import type { OpenCodeClient, ServiceConnection } from "./service.js"
import { readSettings, workspaceDirectory } from "./settings.js"
import { ProviderRequestError, type StreamHandler } from "./stream.js"

const CATALOG_TTL_MS = 15_000
const CHARS_PER_TOKEN = 4

export class OpenCodeChatProvider implements vscode.LanguageModelChatProvider {
  private readonly changed = new vscode.EventEmitter<void>()
  private readonly resolved = new Map<string, CatalogModel>()

  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this.changed.event

  private models: vscode.LanguageModelChatInformation[] | undefined
  private loadedAt = 0

  constructor(
    private readonly connection: ServiceConnection,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  refresh(): void {
    this.models = undefined
    this.resolved.clear()
    this.loadedAt = 0
    this.changed.fire()
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (this.models && Date.now() - this.loadedAt < CATALOG_TTL_MS) return this.models
    if (token.isCancellationRequested) return this.models ?? []

    const client = options.silent
      ? await this.connection.discover().catch(() => undefined)
      : await this.connection.ensure().catch((error) => {
          this.report(error, options.silent)
          return undefined
        })
    if (!client) return this.models ?? []

    try {
      const settings = readSettings()
      const catalog = await loadCatalog(client, workspaceDirectory(), settings.modelFilter)
      this.resolved.clear()
      for (const model of catalog.models) this.resolved.set(model.id, model)
      this.models = catalog.models.map(toLanguageModelInformation)
      this.loadedAt = Date.now()
      this.log.info(`Loaded ${this.models.length} OpenCode model(s) from ${this.connection.url() ?? "unknown service"}.`)
      return this.models
    } catch (error) {
      this.report(error, options.silent)
      return this.models ?? []
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const entry = this.resolved.get(model.id)
    if (!entry) {
      throw new Error(`Model "${model.id}" is no longer available. Run "OpenCode Models: Refresh Models" and try again.`)
    }

    const settings = readSettings()
    const conversation = toDescriptors(messages)
    const tools = (options.tools ?? []).map(toToolDescriptor)
    const toolChoice: ToolChoice =
      options.toolMode === vscode.LanguageModelChatToolMode.Required && tools.length > 0 ? "required" : "auto"

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, settings.requestTimeoutSeconds * 1000)
    token.onCancellationRequested(() => controller.abort())

    const handler: StreamHandler = {
      onText: (delta) => progress.report(new vscode.LanguageModelTextPart(delta)),
      onToolCall: (id, name, input) => progress.report(new vscode.LanguageModelToolCallPart(id, name, asObject(input))),
    }

    try {
      if (entry.protocol === "anthropic") {
        await streamAnthropicMessages(
          {
            baseURL: requireBaseURL(entry),
            apiKey: entry.apiKey,
            model: entry.modelID,
            headers: entry.headers,
            body: entry.body,
            messages: conversation,
            tools,
            toolChoice,
            maxOutputTokens: outputLimit(entry),
          },
          handler,
          controller.signal,
        )
        return
      }

      if (entry.protocol === "openai") {
        await streamOpenAIChat(
          {
            baseURL: requireBaseURL(entry),
            apiKey: entry.apiKey,
            model: entry.modelID,
            headers: entry.headers,
            body: entry.body,
            messages: conversation,
            tools,
            toolChoice,
          },
          handler,
          controller.signal,
        )
        return
      }

      const client = this.connection.peek()
      if (!client) throw new Error("Not connected to the OpenCode service. Run \"OpenCode Models: Refresh Models\" and retry.")
      const text = await generateText(client, entry, serializeTranscript(conversation), controller.signal)
      if (text.length > 0) handler.onText(text)
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut) throw new Error(`The OpenCode request timed out after ${settings.requestTimeoutSeconds}s.`)
        return
      }
      throw new Error(describeError(error))
    } finally {
      clearTimeout(timer)
    }
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    value: string | vscode.LanguageModelChatRequestMessage,
  ): Promise<number> {
    const text =
      typeof value === "string" ? value : toDescriptors([value]).flatMap((message) => message.parts.flatMap(textOf)).join("")
    return Promise.resolve(Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN)))
  }

  private report(error: unknown, silent: boolean): void {
    const message = describeError(error)
    this.log.error(message)
    if (!silent) void vscode.window.showErrorMessage(`OpenCode Models: ${message}`)
  }
}

function toLanguageModelInformation(model: CatalogModel): vscode.LanguageModelChatInformation {
  const fallback = model.protocol === "generate"
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    version: "1",
    detail: model.providerName,
    tooltip: [
      `OpenCode · ${model.providerName}`,
      `${model.providerID}/${model.modelID}`,
      `Context ${model.context.toLocaleString()} · Output ${model.output.toLocaleString()}`,
      fallback ? "Text-only fallback (no tools or images)" : "Streaming chat",
    ].join("\n"),
    maxInputTokens: Math.max(1, model.context - model.output),
    maxOutputTokens: Math.max(1, model.output),
    capabilities: { toolCalling: model.tools, imageInput: model.imageInput },
  }
}

async function generateText(
  client: OpenCodeClient,
  model: CatalogModel,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await client.generate.text(
    { prompt, model: { providerID: model.providerID, id: model.modelID } },
    { signal },
  )
  return result.text
}

function toDescriptors(messages: readonly vscode.LanguageModelChatRequestMessage[]): MessageDescriptor[] {
  return messages.map((message) => ({
    role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user",
    parts: message.content.map(toPart).filter((part): part is PartDescriptor => part !== undefined),
  }))
}

function toPart(part: unknown): PartDescriptor | undefined {
  if (part instanceof vscode.LanguageModelTextPart) return { kind: "text", text: part.value }
  if (part instanceof vscode.LanguageModelDataPart) {
    if (part.mimeType.startsWith("image/")) {
      return { kind: "image", mime: part.mimeType, base64: Buffer.from(part.data).toString("base64") }
    }
    if (part.mimeType.startsWith("text/")) {
      return { kind: "text", text: Buffer.from(part.data).toString("utf8") }
    }
    return undefined
  }
  if (part instanceof vscode.LanguageModelToolCallPart) {
    return { kind: "tool-call", id: part.callId, name: part.name, input: part.input }
  }
  if (part instanceof vscode.LanguageModelToolResultPart) {
    return { kind: "tool-result", id: part.callId, text: resultText(part.content) }
  }
  return undefined
}

function resultText(content: readonly unknown[]): string {
  const pieces: string[] = []
  for (const item of content) {
    if (item instanceof vscode.LanguageModelTextPart) pieces.push(item.value)
    else if (item instanceof vscode.LanguageModelDataPart && item.mimeType.startsWith("text/")) {
      pieces.push(Buffer.from(item.data).toString("utf8"))
    } else if (typeof item === "string") pieces.push(item)
  }
  return pieces.join("\n")
}

function toToolDescriptor(tool: vscode.LanguageModelChatTool): ToolDescriptor {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema }
}

function textOf(part: PartDescriptor): string[] {
  if (part.kind === "text") return [part.text]
  if (part.kind === "tool-result") return [part.text]
  return []
}

function asObject(value: unknown): object {
  return value !== null && typeof value === "object" ? (value as object) : {}
}

function requireBaseURL(model: CatalogModel): string {
  if (!model.baseURL) throw new Error(`No base URL is configured for provider "${model.providerID}".`)
  return model.baseURL
}

function outputLimit(model: CatalogModel): number {
  return Math.min(Math.max(1, model.output), 128_000)
}

function describeError(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    return `The provider rejected the request (HTTP ${error.status}). ${error.message.slice(0, 500)}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}
