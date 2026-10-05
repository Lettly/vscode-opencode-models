import type { OpenCodeClient } from "./service.js"

type ModelInfo = Awaited<ReturnType<OpenCodeClient["model"]["list"]>>["data"][number]
type ProviderInfo = Awaited<ReturnType<OpenCodeClient["provider"]["list"]>>["data"][number]

export type Protocol = "openai" | "anthropic" | "generate"

export interface CatalogModel {
  id: string
  providerID: string
  modelID: string
  name: string
  providerName: string
  family: string
  status: string
  protocol: Protocol
  baseURL: string | undefined
  apiKey: string | undefined
  headers: Record<string, string> | undefined
  body: Record<string, unknown> | undefined
  context: number
  output: number
  tools: boolean
  imageInput: boolean
}

export interface Catalog {
  models: CatalogModel[]
  directory: string | undefined
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  "@opencode/ai/providers/anthropic": "https://api.anthropic.com/v1",
  "@opencode/ai/providers/anthropic-compatible": "https://api.anthropic.com/v1",
  "@opencode/ai/providers/openai": "https://api.openai.com/v1",
  "@opencode/ai/providers/openai-compatible": "https://api.openai.com/v1",
}

export async function loadCatalog(
  client: OpenCodeClient,
  directory: string | undefined,
  filter: readonly string[],
): Promise<Catalog> {
  const location = directory ? { location: { directory } } : undefined
  const [models, providers] = await Promise.all([
    client.model.list(location),
    client.provider.list(location),
  ])

  const providerByID = new Map<string, ProviderInfo>(providers.data.map((provider) => [provider.id, provider]))
  const resolved: CatalogModel[] = []

  for (const model of models.data) {
    if (!model.enabled) continue
    if (!model.capabilities.input.includes("text")) continue
    const provider = providerByID.get(model.providerID)
    if (!provider) continue

    const id = `${model.providerID}/${model.modelID}`
    if (filter.length > 0 && !filter.includes(id) && !filter.includes(model.modelID)) continue

    resolved.push(resolve(provider, model, id))
  }

  resolved.sort((a, b) => a.id.localeCompare(b.id))
  return { models: resolved, directory: models.location?.directory }
}

function resolve(provider: ProviderInfo, model: ModelInfo, id: string): CatalogModel {
  const providerSettings = (provider.settings ?? {}) as Record<string, unknown>
  const packageName = model.package || provider.package || ""

  const baseURL =
    stringValue(providerSettings, "baseURL") ??
    stringValue(providerSettings, "baseUrl") ??
    stringValue(providerSettings, "base_url") ??
    DEFAULT_BASE_URLS[packageName]

  const protocol = detectProtocol(packageName, baseURL)

  return {
    id,
    providerID: model.providerID,
    modelID: model.modelID,
    name: model.name || model.modelID,
    providerName: provider.name || model.providerID,
    family: model.family || model.modelID,
    status: model.status,
    protocol: protocol ?? "generate",
    baseURL: protocol ? baseURL : undefined,
    apiKey: protocol ? stringValue(providerSettings, "apiKey") : undefined,
    headers: protocol ? mergeHeaders(provider, model) : undefined,
    body: protocol ? mergeBody(provider, model) : undefined,
    context: model.limit.context,
    output: model.limit.output,
    tools: protocol ? model.capabilities.tools : false,
    imageInput: protocol ? model.capabilities.input.includes("image") : false,
  }
}

function detectProtocol(packageName: string, baseURL: string | undefined): Protocol | undefined {
  if (!baseURL) return undefined
  if (packageName.endsWith("/anthropic") || packageName.endsWith("/anthropic-compatible")) return "anthropic"
  if (packageName.endsWith("/openai") || packageName.endsWith("/openai-compatible")) return "openai"
  return undefined
}

function mergeHeaders(provider: ProviderInfo, model: ModelInfo): Record<string, string> | undefined {
  const providerHeaders = (provider.headers ?? {}) as Record<string, string>
  const modelHeaders = (model.headers ?? {}) as Record<string, string>
  const merged = { ...providerHeaders, ...modelHeaders }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function mergeBody(provider: ProviderInfo, model: ModelInfo): Record<string, unknown> | undefined {
  const providerBody = (provider.body ?? {}) as Record<string, unknown>
  const modelBody = (model.body ?? {}) as Record<string, unknown>
  const merged = { ...providerBody, ...modelBody }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function stringValue(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}
