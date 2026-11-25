import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { redact } from "./redact.mjs";

const LISTEN_STATE = "0A";

function ipv4FromHex(hex) {
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return null;
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff].join(".");
}

function parseProcAddress(field) {
  const [ipHex, portHex] = field.split(":");
  const port = Number.parseInt(portHex, 16);
  if (!Number.isInteger(port)) return null;
  if (ipHex.length === 8) {
    return { address: ipv4FromHex(ipHex), port };
  }
  if (ipHex.length === 32 && /^0+$/.test(ipHex)) {
    return { address: "::", port };
  }
  return { address: ipHex === "00000000000000000000000001000000" ? "::1" : "ipv6", port };
}

export function processCommand(pid) {
  try {
    if (process.platform === "linux" && existsSync(`/proc/${pid}/cmdline`)) {
      const raw = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").replace(/\0/g, " ").trim();
      return redact(raw).slice(0, 180) || "unknown";
    }
  } catch {
    return "unknown";
  }
  if (process.platform === "win32") {
    try {
      const raw = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" }).trim();
      const image = raw.split(",")[0]?.replaceAll('"', "") || "unknown";
      return redact(image).slice(0, 180);
    } catch {
      return "unknown";
    }
  }
  try {
    const raw = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
    return redact(raw).slice(0, 180) || "unknown";
  } catch {
    return "unknown";
  }
}

function pidForInode(inode) {
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return null;
  }
  const target = `socket:[${inode}]`;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let fds;
    try {
      fds = readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        if (readlinkSync(`/proc/${entry}/fd/${fd}`) === target) return Number(entry);
      } catch {
        // The fd can disappear while we scan.
      }
    }
  }
  return null;
}

function listenersFromProc(port) {
  const listeners = [];
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10 || parts[3] !== LISTEN_STATE) continue;
      const parsed = parseProcAddress(parts[1]);
      if (!parsed || parsed.port !== port) continue;
      const inode = parts[9];
      const pid = pidForInode(inode);
      listeners.push({
        port,
        address: parsed.address,
        pid,
        command: pid == null ? "unresolved" : processCommand(pid),
        loopbackOnly: parsed.address === "127.0.0.1",
      });
    }
  }
  return listeners;
}

function listenersFromLsof(port) {
  let output = "";
  try {
    output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  } catch (error) {
    if (error && error.status === 1) return [];
    throw new Error(`Could not inspect port ${port} (${error instanceof Error ? error.message : "lsof failed"}).`);
  }
  const listeners = [];
  for (const line of output.split("\n").slice(1)) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[1]);
    const name = parts[parts.length - 1] || "";
    const address = name.startsWith("127.0.0.1:") ? "127.0.0.1" : name.split(":")[0] || "unknown";
    listeners.push({
      port,
      address,
      pid: Number.isInteger(pid) ? pid : null,
      command: Number.isInteger(pid) ? processCommand(pid) : "unresolved",
      loopbackOnly: address === "127.0.0.1",
    });
  }
  return listeners;
}

function listenersFromNetstat(port) {
  let output = "";
  try {
    output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  } catch (error) {
    throw new Error(`Could not inspect port ${port} (${error instanceof Error ? error.message : "netstat failed"}).`);
  }
  const listeners = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0] !== "TCP" || parts[3].toUpperCase() !== "LISTENING") continue;
    const local = parts[1];
    const pid = Number(parts[4]);
    const match = /:(\d+)$/.exec(local);
    if (!match || Number(match[1]) !== port) continue;
    const address = local.slice(0, local.lastIndexOf(":")) || "unknown";
    listeners.push({
      port,
      address,
      pid: Number.isInteger(pid) ? pid : null,
      command: Number.isInteger(pid) ? processCommand(pid) : "unresolved",
      loopbackOnly: address === "127.0.0.1",
    });
  }
  return listeners;
}

export function findListeners(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Refusing to inspect invalid port ${port}.`);
  }
  if (process.platform === "linux" && existsSync("/proc/net/tcp")) return listenersFromProc(port);
  if (process.platform === "win32") return listenersFromNetstat(port);
  return listenersFromLsof(port);
}

export function formatListeners(listeners) {
  if (listeners.length === 0) return "no listener";
  return listeners
    .map((listener) => {
      const pid = listener.pid == null ? "unresolved PID" : `PID ${listener.pid}`;
      return `${pid} on ${listener.address}:${listener.port} (${listener.command})`;
    })
    .join("; ");
}

export function assertPortFree(port) {
  const listeners = findListeners(port);
  if (listeners.length === 0) return;
  throw new Error(
    `Port ${port} is already in use by ${formatListeners(listeners)}. Refusing to start. This program does not kill other processes. Confirm the PID, then stop only that process if it is the conflicting bridge.`,
  );
}

export function assertExclusiveLoopback(port, expectedPid) {
  const listeners = findListeners(port);
  if (listeners.length === 0) {
    throw new Error(`Port ${port} is not listening after startup. Fail closed. No other process was signaled.`);
  }
  for (const listener of listeners) {
    if (listener.pid !== expectedPid) {
      throw new Error(
        `Port ${port} is held by ${formatListeners([listener])}, not by the backend PID ${expectedPid}. Refusing to continue and not signaling that process.`,
      );
    }
    if (!listener.loopbackOnly) {
      throw new Error(
        `Port ${port} is listening on ${listener.address}, not 127.0.0.1. Fail closed. No process was signaled.`,
      );
    }
  }
}
