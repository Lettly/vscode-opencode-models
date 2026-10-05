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
import { ServiceConnection } from "./service.js"
import { readSettings, workspaceDirectory } from "./settings.js"
import { ProviderRequestError, type StreamHandler } from "./stream.js"

export interface OpenCodeChatModel extends vscode.LanguageModelChatInformation {
  readonly entry: CatalogModel
}

const CATALOG_TTL_MS = 15_000
const CHARS_PER_TOKEN = 4

export class OpenCodeChatProvider implements vscode.LanguageModelChatProvider<OpenCodeChatModel> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this.changed.event

  private cache: { at: number; models: OpenCodeChatModel[] } | undefined
  private lastWarning: string | undefined

  constructor(
    private readonly connection: ServiceConnection,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  refresh(): void {
    this.cache = undefined
    this.changed.fire()
  }

  async provideLanguageModelChatInformation(_options: { silent: boolean }, _token: vscode.CancellationToken): Promise<OpenCodeChatModel[]> {
    if (this.cache && Date.now() - this.cache.at < CATALOG_TTL_MS) return this.cache.models

    let client: Awaited<ReturnType<ServiceConnection["ensure"]>>
    try {
      client = _options.silent ? await this.connection.discover() : await this.connection.ensure()
    } catch (error) {
      this.report(error)
      return this.cache?.models ?? []
    }
    if (!client) return this.cache?.models ?? []

    try {
      const settings = readSettings()
      const catalog = await loadCatalog(client, workspaceDirectory(), settings.modelFilter)
      const models = catalog.models.map(toChatModel)
      this.cache = { at: Date.now(), models }
      this.log.info(`Loaded ${models.length} OpenCode model(s) from ${this.connection.url() ?? "unknown"}`)
      return models
    } catch (error) {
      this.report(error)
      return this.cache?.models ?? []
    }
  }

  async provideLanguageModelChatResponse(
    model: OpenCodeChatModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const entry = model.entry
    const descriptors = toDescriptors(messages)
    const tools = (options.tools ?? []).map(toToolDescriptor)
    const toolChoice: ToolChoice =
      options.toolMode === vscode.LanguageModelChatToolMode.Required && tools.length > 0 ? "required" : "auto"

    const settings = readSettings()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, settings.requestTimeoutSeconds * 1000)
    const cancellation = token.onCancellationRequested(() => controller.abort())

    const handler: StreamHandler = {
      onText: (delta) => progress.report(new vscode.LanguageModelTextPart(delta)),
      onToolCall: (id, name, input) => progress.report(new vscode.LanguageModelToolCallPart(id, name, toObject(input))),
    }

    try {
      if (entry.protocol === "generate") {
        const client = this.connection.peek()
        if (!client) throw new Error("The OpenCode service is not connected.")
        const result = await client.generate.text(
          { prompt: serializeTranscript(descriptors), model: { providerID: entry.providerID, id: entry.modelID } },
          { signal: controller.signal },
        )
        if (result.text.length > 0) handler.onText(result.text)
        return
      }

      const baseURL = entry.baseURL ?? ""
      if (entry.protocol === "anthropic") {
        await streamAnthropicMessages(
          {
            baseURL,
            apiKey: entry.apiKey,
            model: entry.modelID,
            headers: entry.headers,
            body: entry.body,
            messages: descriptors,
            tools,
            toolChoice,
            maxOutputTokens: entry.output,
          },
          handler,
          controller.signal,
        )
      } else {
        await streamOpenAIChat(
          {
            baseURL,
            apiKey: entry.apiKey,
            model: entry.modelID,
            headers: entry.headers,
            body: entry.body,
            messages: descriptors,
            tools,
            toolChoice,
            maxOutputTokens: undefined,
          },
          handler,
          controller.signal,
        )
      }
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut) throw new Error(`The model did not respond within ${settings.requestTimeoutSeconds}s.`)
        return
      }
      this.report(error)
      throw error instanceof Error ? error : new Error(String(error))
    } finally {
      clearTimeout(timer)
      cancellation.dispose()
    }
  }

  provideTokenCount(_model: OpenCodeChatModel, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> {
    const value = typeof text === "string" ? text : textOfDescriptor(toDescriptors([text]))
    return Promise.resolve(Math.max(1, Math.ceil(value.length / CHARS_PER_TOKEN)))
  }

  private report(error: unknown): void {
    const message = describe(error)
    this.log.warn(message)
    if (message !== this.lastWarning) {
      this.lastWarning = message
      void vscode.window.showWarningMessage(`OpenCode Models: ${message}`)
    }
  }
}

function toChatModel(entry: CatalogModel): OpenCodeChatModel {
  const features = entry.protocol === "generate" ? "text only (no tools or images)" : "streaming chat"
  return {
    id: entry.id,
    name: entry.name,
    family: entry.family,
    version: "1",
    maxInputTokens: Math.max(1, entry.context - entry.output),
    maxOutputTokens: entry.output,
    tooltip: [
      `OpenCode · ${entry.providerName}`,
      `${entry.providerID}/${entry.modelID}`,
      `Context ${entry.context.toLocaleString()} · Output ${entry.output.toLocaleString()}`,
      features,
    ].join("\n"),
    detail: entry.providerName,
    capabilities: { toolCalling: entry.tools, imageInput: entry.imageInput },
    entry,
  }
}

function toDescriptors(messages: readonly vscode.LanguageModelChatRequestMessage[]): MessageDescriptor[] {
  return messages.map((message) => ({
    role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user",
    parts: toParts(message.content),
  }))
}

function toParts(content: readonly unknown[]): PartDescriptor[] {
  const parts: PartDescriptor[] = []
  for (const part of content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      parts.push({ kind: "text", text: part.value })
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      parts.push({ kind: "tool-call", id: part.callId, name: part.name, input: part.input })
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      parts.push({ kind: "tool-result", id: part.callId, text: flattenToolResult(part) })
    } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
      parts.push({ kind: "image", mime: part.mimeType, base64: Buffer.from(part.data).toString("base64") })
    }
  }
  return parts
}

function toToolDescriptor(tool: vscode.LanguageModelChatTool): ToolDescriptor {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema }
}

function flattenToolResult(part: vscode.LanguageModelToolResultPart): string {
  return part.content
    .map((item) => {
      if (item instanceof vscode.LanguageModelTextPart) return item.value
      if (item instanceof vscode.LanguageModelDataPart && item.mimeType.startsWith("text/")) {
        return Buffer.from(item.data).toString("utf8")
      }
      if (typeof item === "string") return item
      try {
        return JSON.stringify(item)
      } catch {
        return ""
      }
    })
    .join("\n")
}

function textOfDescriptor(messages: readonly MessageDescriptor[]): string {
  return messages
    .flatMap((message) => message.parts)
    .filter((part): part is Extract<PartDescriptor, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("")
}

function toObject(input: unknown): object {
  return typeof input === "object" && input !== null ? input : { value: input }
}

function describe(error: unknown): string {
  if (error instanceof ProviderRequestError) {
    return `The provider rejected the request (HTTP ${error.status}). ${error.message}`.trim()
  }
  if (error instanceof Error) return error.message
  return String(error)
}
