# Changelog

## 0.1.0

- Initial release.
- Extension icon (transparent background).
- Registers a VS Code language model chat provider backed by the local OpenCode v2 service.
- Streams OpenAI Chat Completions and Anthropic Messages responses, including tool calls and image input.
- Falls back to OpenCode's stateless `generate` endpoint for providers whose protocol is not implemented.
