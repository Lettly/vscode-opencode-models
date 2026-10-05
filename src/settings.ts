import * as vscode from "vscode"

export interface Settings {
  command: string[]
  modelFilter: string[]
  requestTimeoutSeconds: number
}

export function readSettings(): Settings {
  const configuration = vscode.workspace.getConfiguration("opencodeModels")
  return {
    command: splitCommand(configuration.get<string>("command", "opencode")),
    modelFilter: configuration.get<string[]>("modelFilter", []),
    requestTimeoutSeconds: configuration.get<number>("requestTimeoutSeconds", 120),
  }
}

export function workspaceDirectory(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

function splitCommand(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
}
