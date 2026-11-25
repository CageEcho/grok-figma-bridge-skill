import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireLock(runtimeDir, record) {
  mkdirSync(runtimeDir, { recursive: true });
  chmodSync(runtimeDir, 0o700);
  const lockPath = path.join(runtimeDir, "gateway.lock");
  const payload = JSON.stringify({ ...record, pid: process.pid });
  try {
    writeFileSync(lockPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let existing = null;
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      throw new Error(`Gateway lock at ${lockPath} is unreadable. Refusing to replace it or signal any process.`);
    }
    if (existing && Number.isInteger(existing.pid) && alive(existing.pid)) {
      throw new Error(
        `A gateway is already running as PID ${existing.pid}. Refusing to start a second backend. Stop that PID only after you confirm it is this gateway. This program does not kill it automatically.`,
      );
    }
    unlinkSync(lockPath);
    writeFileSync(lockPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  chmodSync(lockPath, 0o600);
  return lockPath;
}

export function releaseLock(lockPath) {
  if (!lockPath || !existsSync(lockPath)) return;
  try {
    const existing = JSON.parse(readFileSync(lockPath, "utf8"));
    if (existing?.pid !== process.pid) return;
  } catch {
    return;
  }
  unlinkSync(lockPath);
}
