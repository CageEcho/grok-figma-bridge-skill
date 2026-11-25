import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { assertTokenShape } from "./auth.mjs";
import { readEnvFile } from "./env-file.mjs";
import { parseAllowedHosts } from "./hosts.mjs";

export function defaultConfigPath(env = process.env, home = os.homedir()) {
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, "grok-figma-bridge", "gateway.env");
}

export function defaultRuntimeDir(env = process.env, home = os.homedir()) {
  const base = env.XDG_STATE_HOME || path.join(home, ".local", "state");
  return path.join(base, "grok-figma-bridge");
}

function integerEnv(value, fallback, { min, max, name }) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

export function resolveConfig({ env = process.env, options = {} } = {}) {
  const configPath = options.configPath || env.GROK_FIGMA_BRIDGE_CONFIG || defaultConfigPath(env);
  let fileVars = {};
  if (existsSync(configPath)) {
    fileVars = readEnvFile(configPath);
  }
  const pick = (key) => {
    if (options[key] != null && options[key] !== "") return String(options[key]);
    if (env[key] != null && env[key] !== "") return env[key];
    if (fileVars[key] != null && fileVars[key] !== "") return fileVars[key];
    return "";
  };

  const token = assertTokenShape(pick("GROK_FIGMA_BRIDGE_TOKEN"));
  const port = integerEnv(pick("GROK_FIGMA_BRIDGE_PORT") || "3847", 3847, {
    min: 0,
    max: 65535,
    name: "GROK_FIGMA_BRIDGE_PORT",
  });
  const allowedHosts = parseAllowedHosts(pick("GROK_FIGMA_BRIDGE_ALLOWED_HOSTS"));
  const upstreamEntry = pick("GROK_FIGMA_BRIDGE_UPSTREAM_ENTRY");
  if (!upstreamEntry) {
    throw new Error("GROK_FIGMA_BRIDGE_UPSTREAM_ENTRY is required and was not set.");
  }
  const runtimeDir = options.runtimeDir || pick("GROK_FIGMA_BRIDGE_RUNTIME_DIR") || defaultRuntimeDir(env);
  const expectWs = (pick("GROK_FIGMA_BRIDGE_EXPECT_WS") || "1") !== "0";
  const callTimeoutMs = integerEnv(pick("GROK_FIGMA_BRIDGE_CALL_TIMEOUT_MS") || "120000", 120000, {
    min: 1000,
    max: 300000,
    name: "GROK_FIGMA_BRIDGE_CALL_TIMEOUT_MS",
  });
  const maxInflight = integerEnv(pick("GROK_FIGMA_BRIDGE_MAX_INFLIGHT") || "4", 4, {
    min: 1,
    max: 32,
    name: "GROK_FIGMA_BRIDGE_MAX_INFLIGHT",
  });
  const sessionIdleMs = integerEnv(pick("GROK_FIGMA_BRIDGE_SESSION_IDLE_MS") || String(30 * 60 * 1000), 30 * 60 * 1000, {
    min: 1000,
    max: 24 * 60 * 60 * 1000,
    name: "GROK_FIGMA_BRIDGE_SESSION_IDLE_MS",
  });

  return {
    token,
    port,
    allowedHosts,
    upstreamEntry: path.resolve(upstreamEntry),
    runtimeDir: path.resolve(runtimeDir),
    configPath,
    expectWs,
    callTimeoutMs,
    maxInflight,
    sessionIdleMs,
    wsPort: 18211,
    bodyLimit: 4 * 1024 * 1024,
  };
}
