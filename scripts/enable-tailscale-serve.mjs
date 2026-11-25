#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultConfigPath } from "../src/config.mjs";
import { readEnvFile } from "../src/env-file.mjs";
import { findListeners } from "../src/port-holders.mjs";
import { assertServeStatusIsPrivate, buildServeArgs, buildServeOffArgs } from "../src/tailscale-serve.mjs";

const exec = promisify(execFile);
const argv = process.argv.slice(2);
if (argv.some((arg) => /funnel/i.test(arg))) {
  process.stderr.write("Refusing to run because an argument mentions Funnel. Use tailscale serve only.\n");
  process.exit(1);
}

const configPath = process.env.GROK_FIGMA_BRIDGE_CONFIG || defaultConfigPath();
const vars = readEnvFile(configPath);
const port = Number(vars.GROK_FIGMA_BRIDGE_PORT || "3847");
const off = argv.includes("--off");
const args = off ? buildServeOffArgs() : buildServeArgs(port);

if (!off) {
  const listeners = findListeners(port).filter((listener) => listener.loopbackOnly);
  if (listeners.length === 0) {
    process.stderr.write(
      `Refusing to enable Tailscale Serve because 127.0.0.1:${port} is not listening. Start the gateway first. No process was signaled.\n`,
    );
    process.exit(1);
  }
}

const env = { PATH: process.env.PATH, HOME: process.env.HOME };
await exec("tailscale", args, { env, windowsHide: true });
const status = await exec("tailscale", ["serve", "status"], { env, windowsHide: true });
assertServeStatusIsPrivate(status.stdout);
process.stdout.write(status.stdout);
if (!status.stdout.includes("127.0.0.1")) {
  process.stderr.write("Tailscale serve status did not mention 127.0.0.1. Check that Serve is proxying the local gateway and that Funnel is off.\n");
  process.exit(1);
}
process.stdout.write(off ? "Requested Tailscale Serve off for https/443 only.\n" : "Tailscale Serve is configured for private HTTPS. Funnel was not enabled.\n");
