import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { loadCatalog } from "../src/catalog.ts"
import { streamOpenAIChat } from "../src/openai.ts"

const endpoint = await Service.discover({ version: (v) => v.startsWith("2.") })
if (!endpoint) throw new Error("no service")
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })

const catalog = await loadCatalog(client, process.argv[2] ?? process.cwd(), [])
console.log("CATALOG", catalog.models.length)
for (const m of catalog.models) console.log(" ", m.id, m.protocol, m.tools, m.imageInput, m.providerName)

const model = catalog.models.find((m) => m.protocol === "openai" && m.tools)
if (!model) throw new Error("no OpenAI-compatible model with tools available")
const parts: string[] = []
const calls: string[] = []
await streamOpenAIChat(
  {
    baseURL: model.baseURL!,
    apiKey: model.apiKey,
    model: model.modelID,
    headers: model.headers,
    body: model.body,
    messages: [{ role: "user", parts: [{ kind: "text", text: "Call the ping tool with value 3. Do not write prose." }] }],
    tools: [
      { name: "ping", description: "Ping", inputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] } },
    ],
    toolChoice: "auto",
    maxOutputTokens: undefined,
  },
  {
    onText: (d) => parts.push(d),
    onToolCall: (id, name, input) => calls.push(`${name}(${JSON.stringify(input)}) id=${id}`),
  },
  AbortSignal.timeout(120_000),
)
console.log("MODEL", model.id)
console.log("TEXT", JSON.stringify(parts.join("")))
console.log("TOOLCALLS", JSON.stringify(calls))
