---
name: grok-figma-bridge
description: >-
  Use when installing, checking, troubleshooting, or operating Figma Desktop
  from Grok Bot through the figma-unified-mcp companion plugin without a Figma
  REST token. The route is a remote HTTP MCP connector, private Tailscale Serve
  with Funnel off, this package's loopback authenticated HTTP-to-stdio gateway,
  one hardened stdio backend on 127.0.0.1 port 18211, and the open plugin panel.
  Keep that panel green Connected in the target Desktop file. Not for public
  tunnels, bot-local commands, or asking for tokens in chat.
license: MIT
---

# Grok Figma Bridge

> **重要提示 / Mandatory notice**
>
> 使用前，在目标 Figma Desktop 文件中打开 `figma-unified-mcp` 插件面板，确认显示绿色 `Connected`。操作期间保持插件和该文件打开；可以切换到其他应用。连接断开时，先重新打开插件并连接，再继续。
>
> Before any canvas action, open the `figma-unified-mcp` plugin panel inside the target Figma Desktop file and confirm green `Connected`. Keep the plugin and that file open. Switching applications is fine. If it disconnects, reconnect the plugin before retrying.

## What this skill is for

Use this skill to connect Grok Bot to Figma Desktop through the upstream MIT project [`sso-ss/figma-unified-mcp`](https://github.com/sso-ss/figma-unified-mcp), without a Figma REST token.

Grok Bot's local command connector runs on the bot's own computer. It cannot see Figma Desktop on the user's computer. The route is:

1. Grok Bot remote HTTP MCP connector (`transport: http`).
2. Tailscale Serve private HTTPS. Funnel stays off.
3. This package's authenticated HTTP-to-stdio gateway on `127.0.0.1`.
4. One hardened `figma-unified-mcp` stdio process. Its plugin WebSocket listens on `127.0.0.1:18211`.
5. The Figma Desktop companion plugin, panel open.

The gateway in this package is a new helper built on the public MCP TypeScript SDK. It is not a copy of a private script from the original setup. Install steps are in [README.md](README.md) and [README.en.md](README.en.md).

## What has and has not been checked

- **2026-11-25, existing Grok Bot setup:** read, create a temporary rectangle, read it back, and delete it. 106 tools. REST API was not configured. That setup is separate from this helper.
- **This package's automated tests:** auth failures, MCP initialize, tools/list, and tools/call against a mock stdio subprocess; a second process refuses to start and names the running PID; stopping the gateway stops that mock child. These tests do not call Figma.
- **Packaging workspace, pinned upstream only:** commit `1f089393e73da8a5955bd48b973b3af2ac7def28` was patched so the WebSocket host is `127.0.0.1`, built, and started under the gateway. The listener was `127.0.0.1:18211` owned by that child. `tools/list` returned 106 tools, including `figma_status`. No Figma tool was called and no Figma account was used.
- **Not checked:** a clean colleague computer, macOS or Windows end to end, other AI clients, and a company tailnet.

## How to operate

1. Ask the user to confirm the target file is an explicitly authorized blank test file, open in Figma Desktop, with the plugin panel green `Connected`.
2. Call `figma_status`. The 2026-11-25 session reported `REST API` not configured, WebSocket port `18211` with one client, channel `figma`, and plugin-bridge writes available. This package did not re-call `figma_status`. If the panel is open and the status shows zero clients, ask the user to click Connect, then call `figma_connect_plugin` with channel `figma` only after they confirm the panel settings are localhost, port `18211`, and channel `figma`.
3. Read with a plugin-bridge tool that does not need `fileKey`, such as `figma_get_viewport`, `figma_get_selection`, or `figma_get_styles`.
4. Write only after the user explicitly agrees. Create one temporary node, read it back, delete it, and confirm it is gone. Stop if Figma says the file is read-only or permission is denied.

## Boundaries

- Do not ask for passwords, cookies, or Figma tokens in chat. The gateway token stays in the local mode `0600` file. The user enters it in the connector credential field.
- Do not enable Tailscale Funnel or publish port `18211`.
- Do not run a broad `pkill`. If port `18211` is busy, the gateway prints the listening PID and exits. Stop only that PID after the user confirms it is the conflicting bridge.
- If a tool says it needs `FIGMA_ACCESS_TOKEN`, stop. This path does not configure that token.
- This is not an official Figma integration. The plugin does not bypass login, file permissions, or plan limits, and it does not make Grok Bot usage free.
- Troubleshooting and uninstall: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md), [docs/TROUBLESHOOTING.en.md](docs/TROUBLESHOOTING.en.md).
