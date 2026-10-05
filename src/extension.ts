import * as vscode from "vscode"
import { OpenCodeChatProvider } from "./provider.js"
import { ServiceConnection } from "./service.js"

const VENDOR = "opencode-v2"

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("OpenCode Models", { log: true })
  const connection = new ServiceConnection()
  const provider = new OpenCodeChatProvider(connection, log)

  context.subscriptions.push(
    log,
    vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
    vscode.commands.registerCommand("opencodeModels.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("opencodeModels.manage", () => manage(connection, provider, log)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("opencodeModels")) return
      connection.reset()
      provider.refresh()
    }),
  )
}

export function deactivate(): void {}

async function manage(connection: ServiceConnection, provider: OpenCodeChatProvider, log: vscode.LogOutputChannel): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { id: "refresh", label: "$(refresh) Refresh models", description: "Reload the model list from OpenCode" },
      { id: "reconnect", label: "$(debug-restart) Restart connection", description: "Discard the current OpenCode connection" },
      { id: "log", label: "$(output) Show log", description: "Open the OpenCode Models output channel" },
      { id: "settings", label: "$(gear) Open settings", description: "Configure OpenCode Models" },
    ],
    { title: `OpenCode Models — ${connection.url() ?? "not connected"}` },
  )

  switch (choice?.id) {
    case "refresh":
      provider.refresh()
      break
    case "reconnect":
      connection.reset()
      provider.refresh()
      break
    case "log":
      log.show()
      break
    case "settings":
      await vscode.commands.executeCommand("workbench.action.openSettings", "opencodeModels")
      break
  }
}
