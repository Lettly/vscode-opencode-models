<p align="center">
  <img src="https://github.com/Lettly/vscode-opencode-models/raw/HEAD/resources/icon.png" width="128" height="128" alt="OpenCode Models icon" />
</p>

# OpenCode Models for VS Code

Use models from your **OpenCode v2** configuration in VS Code's native AI Chat model picker. This is a language-model provider, not another chat panel.

For OpenAI-compatible and Anthropic Messages providers, the extension streams text and returns tool calls to VS Code. **VS Code owns tool execution**, so its native Agent-mode loop can read files, edit code, and run commands using the tools you already have enabled.

## Features

- Discovers configured models from the OpenCode v2 background service.
- Uses OpenCode's merged global and project configuration.
- Reuses provider endpoints, headers, bodies, and API keys in memory.
- Streams text and native tool calls for OpenAI-compatible and Anthropic Messages endpoints.
- Sends images when the model advertises image input.
- Supports cancellation and a configurable request timeout.
- Falls back to text-only OpenCode generation for unsupported provider packages.
- No modification of OpenCode config, no API keys copied into VS Code settings, and no telemetry.

## Requirements

- VS Code **1.120+** with native AI Chat available.
- OpenCode **v2** installed and configured on the extension host's machine.
- For Agent mode, a configured OpenAI-compatible or Anthropic Messages provider endpoint.
- Copilot Business/Enterprise policies may prevent third-party models. The extension cannot bypass an administrator's policy.

On Remote SSH, WSL, or Dev Containers, the extension runs in the remote workspace host. Install and configure OpenCode there, not only on your desktop.

## Install

Download the `.vsix` from [GitHub Releases](https://github.com/Lettly/vscode-opencode-models/releases), then run **Extensions: Install from VSIX…** in VS Code.

Or build from source:

```sh
git clone https://github.com/Lettly/vscode-opencode-models.git
cd vscode-opencode-models
npm ci
npm run verify
npm run package
code --install-extension opencode-models-0.1.0.vsix
```

## Use

1. Set up your providers in OpenCode. Verify they are available in OpenCode's model picker.
2. Open a trusted workspace in VS Code.
3. Open the native Chat view and use its model picker to choose a model under **OpenCode**. In versions that require it, open **Manage Models** first and enable the model.
4. Select **Agent** for a model with tool support, or **Ask** for text-only models.
5. After changing your OpenCode configuration, run **OpenCode Models: Refresh Models**.

**OpenCode Models: Manage Connection** lets you refresh models, reset the connection, show logs, or open settings.

The extension discovers an existing registered OpenCode service. If none exists, an explicit model-discovery request starts the shared background service using `opencode serve --service`. Silent discovery does not start a service or display a sign-in prompt.

## Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `opencodeModels.command` | `opencode` | OpenCode executable used to start the service. Set an absolute path if VS Code cannot find it on `PATH`. |
| `opencodeModels.modelFilter` | `[]` | Optional allowlist of `provider/model` IDs. Empty means all available text models. |
| `opencodeModels.requestTimeoutSeconds` | `120` | Maximum request duration, from 10 to 600 seconds. |

An example OpenCode v2 custom provider:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "local": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:8000/v1",
        "apiKey": "{env:LOCAL_MODEL_API_KEY}"
      }
    }
  }
}
```

Let OpenCode resolve configuration and authentication. Do not put provider API keys in this extension's settings.

## Compatibility and limitations

This first release supports the **Chat Completions** protocol for OpenAI/OpenAI-compatible provider packages and **Messages** for Anthropic/Anthropic-compatible packages. It does not yet implement OpenAI Responses, Gemini's native API, Bedrock, Azure-specific protocols, or arbitrary provider plugins.

Direct requests bypass OpenCode's agent loop and request hooks. OAuth token exchange/refresh, custom authentication plugins, provider policy enforcement, reasoning signatures, model variants, and some provider-specific request settings are **not reproduced**. Models requiring those features may work in OpenCode but not through the direct backend. Use an API-key-based compatible endpoint for Agent mode.

Unsupported packages use OpenCode's stateless text-generation endpoint. These models advertise no tools or images and are intended for Ask mode. The fallback serializes the conversation into a prompt and returns the completed answer; it is not token streaming and uses the service's base configuration rather than project-scoped inference.

Token counts are estimates, not provider-specific tokenization. Context limits are taken from OpenCode's model metadata.

## Privacy and security

- The extension calls your local OpenCode service and your configured model provider. Prompts, attached images, and tool results are sent to that provider.
- The provider API can return API keys. The extension keeps them in memory and does not store or intentionally log them.
- Debug output contains model counts and connection information, not request bodies or keys. Provider error messages may still contain provider-supplied details; review logs before sharing them.
- Only use trusted workspaces: OpenCode can load project configuration and plugins.
- No credentials, private configuration, or internal provider endpoints are part of this repository.

## Development

```sh
npm ci
npm run check
npm test
npm run build
npm run package
```

Press F5 in VS Code to launch an Extension Development Host. CI checks types, runs tests, and builds the extension on each push and pull request.

## License

MIT. This is an independent project and is not affiliated with OpenCode, Microsoft, or GitHub.
