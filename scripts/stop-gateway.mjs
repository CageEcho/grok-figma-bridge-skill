#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defaultRuntimeDir } from "../src/config.mjs";
import { processCommand } from "../src/port-holders.mjs";

const runtimeDir = process.env.GROK_FIGMA_BRIDGE_RUNTIME_DIR || defaultRuntimeDir();
const lockPath = path.join(runtimeDir, "gateway.lock");
if (!existsSync(lockPath)) {
  process.stdout.write(`No gateway lock at ${lockPath}.\n`);
  process.exit(0);
}
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const pid = lock.pid;
if (!Number.isInteger(pid)) {
  process.stderr.write("Lock file has no integer PID. Refusing to signal any process.\n");
  process.exit(1);
}
const command = processCommand(pid);
if (!command.includes("gateway.mjs")) {
  process.stderr.write(
    `PID ${pid} command does not include gateway.mjs (${command}). Refusing to signal it.\n`,
  );
  process.exit(1);
}
try {
  process.kill(pid, "SIGTERM");
} catch (error) {
  process.stderr.write(`Could not signal PID ${pid}: ${error instanceof Error ? error.message : "error"}\n`);
  process.exit(1);
}
process.stdout.write(`Sent SIGTERM to gateway PID ${pid} only.\n`);
