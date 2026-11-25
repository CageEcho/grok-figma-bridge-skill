#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { generateToken } from "../src/auth.mjs";
import { defaultConfigPath } from "../src/config.mjs";
import { readEnvFile, removeFileIfExists, writePrivateEnvFile } from "../src/env-file.mjs";
import { parseAllowedHosts } from "../src/hosts.mjs";

function usage() {
  return `Usage: node scripts/setup.mjs --upstream /path/to/figma-unified-mcp/dist/server.js [--allowed-host YOUR_DEVICE.YOUR_TAILNET.ts.net] [--port 3847] [--config path] [--rotate] [--delete-credentials]

Writes a mode 0600 settings file. The bearer token is never printed.
`;
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return "";
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  process.stdout.write(usage());
  process.exit(0);
}

const configPath = argValue(argv, "--config") || process.env.GROK_FIGMA_BRIDGE_CONFIG || defaultConfigPath();

if (argv.includes("--delete-credentials")) {
  removeFileIfExists(configPath);
  process.stdout.write(`Removed ${configPath} if it was present. Nothing from the file was printed.\n`);
  process.exit(0);
}

const upstream = argValue(argv, "--upstream");
if (!upstream) {
  process.stderr.write(usage());
  process.exit(1);
}
const resolvedUpstream = path.resolve(upstream);
if (!existsSync(resolvedUpstream)) {
  throw new Error("Upstream entry does not exist. Build it with scripts/fetch-upstream.mjs first.");
}

const port = argValue(argv, "--port") || "3847";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("Port must be an integer from 1 to 65535.");
}

const hosts = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === "--allowed-host") hosts.push(argv[index + 1] || "");
}
const allowed = parseAllowedHosts(hosts.filter(Boolean).join(","));
const extraHosts = allowed.filter((host) => !["localhost", "127.0.0.1", "[::1]"].includes(host));

let token = "";
if (existsSync(configPath) && !argv.includes("--rotate")) {
  token = readEnvFile(configPath).GROK_FIGMA_BRIDGE_TOKEN || "";
}
if (!token || argv.includes("--rotate")) token = generateToken();

writePrivateEnvFile(configPath, {
  GROK_FIGMA_BRIDGE_TOKEN: token,
  GROK_FIGMA_BRIDGE_PORT: String(Number(port)),
  GROK_FIGMA_BRIDGE_ALLOWED_HOSTS: allowed.join(","),
  GROK_FIGMA_BRIDGE_UPSTREAM_ENTRY: resolvedUpstream,
  GROK_FIGMA_BRIDGE_EXPECT_WS: "1",
});

const hostForUrl = extraHosts[0] || "YOUR_DEVICE.YOUR_TAILNET.ts.net";
process.stdout.write(`Wrote ${configPath} (mode 0600).\n`);
process.stdout.write("The bearer token is only in that file. It was not printed.\n");
process.stdout.write("Enter it in the connector Authorization header through the client credential field. Do not paste it into chat.\n");
process.stdout.write(`Local endpoint: http://127.0.0.1:${Number(port)}/mcp\n`);
process.stdout.write(`Private HTTPS endpoint after Tailscale Serve: https://${hostForUrl}/mcp\n`);
process.stdout.write("Next: node src/gateway.mjs\n");
process.stdout.write("Then: node scripts/enable-tailscale-serve.mjs\n");
