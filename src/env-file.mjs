import { chmodSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";

const KEY = /^[A-Z][A-Z0-9_]*$/;

export function parseEnvFile(text, filePath = "env file") {
  const vars = {};
  const lines = String(text).split(/\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid line ${index + 1} in ${filePath}. Expected KEY=VALUE. The line was not printed.`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (!KEY.test(key) || value.includes("\r") || /[\r\n]/.test(value)) {
      throw new Error(`Invalid line ${index + 1} in ${filePath}. The line was not printed.`);
    }
    vars[key] = value;
  }
  return vars;
}

export function readEnvFile(filePath) {
  return parseEnvFile(readFileSync(filePath, "utf8"), filePath);
}

export function writePrivateEnvFile(filePath, vars) {
  const lines = [
    "# Local gateway settings. Do not commit, log, or paste this file into chat.",
    ...Object.entries(vars).map(([key, value]) => `${key}=${value}`),
    "",
  ];
  mkdirSync(path.dirname(filePath), { recursive: true });
  chmodSync(path.dirname(filePath), 0o700);
  writeFileSync(filePath, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function removeFileIfExists(filePath) {
  if (existsSync(filePath)) unlinkSync(filePath);
}
