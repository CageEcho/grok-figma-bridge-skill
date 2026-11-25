# 故障排查、安全边界与卸载

> 先确认你的电脑在线，并且目标 Figma Desktop 文件里的 `figma-unified-mcp` 面板是绿色 **Connected**。断开后先重连，再重试。

## 1. 常见问题

### 1.1 `no Figma plugin connected` 或 `0 client(s) connected`

1. 使用 **Figma Desktop**。[下载](https://www.figma.com/downloads/)。网页版不能导入本地 manifest。
2. 在目标文件里重新运行 **Plugins → Development → figma-unified-mcp**。
3. 面板应显示绿色 **Connected**。需要时点 **Connect**。
4. Advanced settings 里 Server 用插件允许的 `localhost`，端口 `18211`，频道 `figma`。manifest 的 `networkAccess` 只有 `ws://localhost:18211`。
5. 再调用 `figma_status`。2026-11-25 那次已有设置看到的是 REST 未配置、`18211` 上有 1 个客户端、频道 `figma`。本包的测试没有调用 `figma_status`。

如果监听地址已经是 `127.0.0.1` 而面板仍连不上，不要改成 `0.0.0.0`。localhost 可能走了 IPv6 `::1`。这一情况没有在 Mac 上测试。

### 1.2 端口 `18211` 或网关端口已被占用

只能有一个后端占用 `18211`。网关在启动前查监听者。如果有人占用，它打印 PID 和缩短后的命令，然后退出。它不结束那个进程。

macOS / Linux：

```bash
lsof -nP -iTCP:18211 -sTCP:LISTEN
ps -p <PID> -o pid,ppid,command
```

Windows PowerShell：

```powershell
netstat -ano | findstr :18211
tasklist /FI "PID eq <PID>"
```

确认 PID 就是冲突的 `figma-unified-mcp` 之后，只停止那一个 PID，或在占用它的客户端里关掉对应连接。不要用宽泛的 `pkill`。

上游 `plugin-bridge.ts` 在 `EADDRINUSE` 时仍可能去结束占用该端口的旧 node 进程。本网关先拒绝启动，就是为了不走到那里。补丁没有删掉那段上游代码，因为多改一行就会和固定版本对不上。

### 1.3 网关返回 401 或 403

- `401`：没有 Bearer，或 token 不对。缺失和错误返回同一段 JSON，里面没有 token。不要把 token 放进 URL。
- `403`：TCP 来源不是回环，或 Host / Origin 不在允许列表。把 MagicDNS 名用 `setup.mjs --allowed-host` 写进私密设置，然后重启网关。本地日志可以有被拒绝的主机名，但不会记录 Authorization。
- 设置文件在模式 `0600` 的路径里。`setup.mjs` 不打印 token。

### 1.4 为什么不能把 stdio 配置直接交给 Grok Bot

Grok Bot 的本地命令在 Bot 自己的电脑上运行。要用远程 HTTP 连接器和 Tailscale Serve。见 [`templates/grok-bot-remote-mcp.template.json`](../templates/grok-bot-remote-mcp.template.json)。

### 1.5 `Need FIGMA_ACCESS_TOKEN` 或权限错误

需要 REST 的工具不在这条路径里。不要在聊天里要 token。Figma 报告只读或没有权限时停止，不要尝试绕过。

## 2. 卸载

1. `node scripts/stop-gateway.mjs` 只向锁文件中的网关 PID 发送 `SIGTERM`。命令行里没有 `gateway.mjs` 时它会拒绝。
2. `node scripts/enable-tailscale-serve.mjs --off` 只关闭 https/443 的 Serve。它不运行 `tailscale serve reset`，以免清掉这台机器上的其他 Serve。不要运行 `tailscale funnel`。
3. 在 Grok Bot 里移除这个私有连接器。不再需要时，断开 Tailscale 插件授权。
4. 在 Figma Desktop 的 **Plugins → Development** 里移除 `figma-unified-mcp`。
5. `node scripts/setup.mjs --delete-credentials` 删除本地设置文件，并且不打印内容。
6. 确认 `18211` 没有残留监听后，删除 git 忽略的 `upstream/figma-unified-mcp` 目录。
