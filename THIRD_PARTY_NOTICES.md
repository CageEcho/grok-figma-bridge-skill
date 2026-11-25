# Third-party notices

Grok Figma Bridge Skill is an independent unofficial guide and local helper. It is not a Figma product.

## figma-unified-mcp

- Repository: https://github.com/sso-ss/figma-unified-mcp
- Pinned commit: `1f089393e73da8a5955bd48b973b3af2ac7def28`
- License: MIT, copyright (c) 2026 sso-ss
- Author: https://github.com/sso-ss

This repository does not vendor that project. `scripts/fetch-upstream.mjs` clones the pinned commit into a gitignored directory, checks one WebSocket constructor line, and sets its host to `127.0.0.1`. The pin file quotes that single line so a different upstream revision fails closed. The upstream MIT terms still require the upstream copyright and permission notice to stay with any copy of the upstream software. Those copies stay on the computer that runs the fetch script.

The companion plugin is imported from that checkout's `figma-plugin/manifest.json`. Upstream does not document a separate Figma Community download URL for it.

## MCP TypeScript SDK

The gateway depends on these exact npm packages, which stay under the Apache License 2.0:

- `@modelcontextprotocol/client` 2.4.0
- `@modelcontextprotocol/server` 2.4.0
- `@modelcontextprotocol/node` 2.1.2

They are not vendored as source. `package-lock.json` records the install. Their notices and the Apache License 2.0 text ship inside `node_modules` after `npm ci`.

## Names

Figma and FigJam are trademarks of Figma, Inc. Grok Bot, Cursor, and Tailscale are names of their own owners. This repository does not speak for them.
