# Troubleshooting, boundaries, and uninstall

> Confirm the computer is online and the `figma-unified-mcp` panel in the target Figma Desktop file is green **Connected**. If it drops, reconnect before retrying.

## 1. Common problems

### 1.1 `no Figma plugin connected` or `0 client(s) connected`

1. Use **Figma Desktop**. [Download](https://www.figma.com/downloads/). The browser cannot import a local manifest.
2. In the target file, run **Plugins → Development → figma-unified-mcp** again.
3. The panel should show green **Connected**. Choose **Connect** if it does not.
4. In Advanced settings, Server stays on the `localhost` value the plugin allows, port `18211`, channel `figma`. The manifest `networkAccess` list is only `ws://localhost:18211`.
5. Call `figma_status` again. The existing setup on 2026-11-25 reported REST unconfigured, one client on `18211`, and channel `figma`. This package's tests did not call `figma_status`.

If the listener is already `127.0.0.1` and the panel still cannot connect, do not switch the bind to `0.0.0.0`. Localhost may be using IPv6 `::1`. That case was not tested on a Mac.

### 1.2 Port `18211` or the gateway port is busy

Only one backend may hold `18211`. Before it listens, the gateway looks up the current listener. If one exists, it prints the PID and a shortened command, then exits. It does not stop that process.

macOS / Linux:

```bash
lsof -nP -iTCP:18211 -sTCP:LISTEN
ps -p <PID> -o pid,ppid,command
```

Windows PowerShell:

```powershell
netstat -ano | findstr :18211
tasklist /FI "PID eq <PID>"
```

After you confirm the PID is the conflicting `figma-unified-mcp`, stop only that PID, or disconnect it in the client that started it. Do not use a broad `pkill`.

Upstream `plugin-bridge.ts` can still stop an older node process on `EADDRINUSE`. This gateway refuses to start when `18211` is taken so that path is not reached. The patch does not delete that upstream code, because a wider edit would fail the pinned hash.

### 1.3 Gateway returns 401 or 403

- `401`: missing or wrong bearer. Both cases return the same JSON and do not echo the token. Do not put the token in the URL.
- `403`: the TCP peer is not loopback, or Host / Origin is not allowed. Add the MagicDNS name with `setup.mjs --allowed-host` and restart the gateway. The local log may contain the rejected hostname. It does not record Authorization.
- The settings file is mode `0600`. `setup.mjs` does not print the token.

### 1.4 Why a stdio block does not connect Grok Bot

Grok Bot's local command runs on the bot's computer. Use the remote HTTP connector and Tailscale Serve. See [`templates/grok-bot-remote-mcp.template.json`](../templates/grok-bot-remote-mcp.template.json).

### 1.5 `Need FIGMA_ACCESS_TOKEN` or a permission error

Tools that need REST are outside this path. Do not ask for a token in chat. If Figma says the file is read-only or permission is denied, stop. Do not try to get around it.

## 2. Uninstall

1. `node scripts/stop-gateway.mjs` sends `SIGTERM` only to the gateway PID in the lock file. It refuses when the command line does not contain `gateway.mjs`.
2. `node scripts/enable-tailscale-serve.mjs --off` turns off Serve for https/443 only. It does not run `tailscale serve reset`, which would clear every Serve config on the machine. Do not run `tailscale funnel`.
3. Remove the private connector in Grok Bot. Disconnect the Tailscale plugin authorization when you no longer need it.
4. Remove `figma-unified-mcp` under **Plugins → Development** in Figma Desktop.
5. `node scripts/setup.mjs --delete-credentials` deletes the local settings file and does not print its contents.
6. After you confirm nothing is listening on `18211`, delete the gitignored `upstream/figma-unified-mcp` directory.
