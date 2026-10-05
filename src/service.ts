import { OpenCode } from "@opencode/client"
import { Service, type Endpoint } from "@opencode/client/service"
import { readSettings } from "./settings.js"

export type OpenCodeClient = ReturnType<typeof OpenCode.make>

const OPENCODE_V2 = (version: string): boolean => version.startsWith("2.")

export class ServiceConnection {
  private endpoint: Endpoint | undefined
  private client: OpenCodeClient | undefined
  private starting: Promise<OpenCodeClient | undefined> | undefined

  peek(): OpenCodeClient | undefined {
    return this.client
  }

  url(): string | undefined {
    return this.endpoint?.url
  }

  reset(): void {
    this.endpoint = undefined
    this.client = undefined
  }

  /** Use an already registered service without starting one. */
  async discover(): Promise<OpenCodeClient | undefined> {
    if (this.client) return this.client
    const endpoint = await Service.discover({ version: OPENCODE_V2 })
    return endpoint ? this.connect(endpoint) : undefined
  }

  /** Use a registered service, starting the shared background service when necessary. */
  async ensure(): Promise<OpenCodeClient | undefined> {
    if (this.client) return this.client
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async start(): Promise<OpenCodeClient | undefined> {
    const registered = await Service.discover({ version: OPENCODE_V2 })
    if (registered) return this.connect(registered)

    const { command } = readSettings()
    if (command.length === 0) throw new Error("opencodeModels.command is empty.")
    const endpoint = await Service.ensure({
      version: OPENCODE_V2,
      command: [...command, "serve", "--service"],
    })
    return this.connect(endpoint)
  }

  private connect(endpoint: Endpoint): OpenCodeClient {
    this.endpoint = endpoint
    this.client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    return this.client
  }
}
