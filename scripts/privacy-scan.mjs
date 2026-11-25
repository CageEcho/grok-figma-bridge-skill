#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/package-root.mjs";

const TEXT_EXTENSIONS = new Set([".md", ".mjs", ".js", ".json", ".txt", ".html", ".css", ".yml", ".yaml"]);
const SKIP_DIRS = new Set([".git", "node_modules", "upstream", ".runtime", "artifacts", "coverage"]);
const ALLOWED_TOKEN = "synthetic-test-token-do-not-use-0123456789abcd";
const ALLOWED_WRONG = "synthetic-wrong-token-do-not-use-0123456789abcd";
const ALLOWED_TSNET = new Set([
  "YOUR_DEVICE.YOUR_TAILNET.ts.net",
  "your-device.your-tailnet.ts.net",
  "<YOUR_DEVICE>.<YOUR_TAILNET>.ts.net",
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TAILSCALE_IP = /\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const TSNET = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net\b/gi;
const SECRET_PREFIX = /\b(?:ghp_|github_pat_|sk-|xox[baprs]-|AKIA|figd_)[A-Za-z0-9_\-]{8,}/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const HOME_PATH = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[A-Za-z0-9._-]+/g;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function pngHasTextChunk(buffer) {
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    if (["tEXt", "iTXt", "zTXt", "eXIf"].includes(type)) return type;
    offset += 12 + length;
    if (type === "IEND") return "";
  }
  return "";
}

export function scanText(text, file = "text") {
  const findings = [];
  const stripped = text.split(ALLOWED_TOKEN).join("").split(ALLOWED_WRONG).join("");
  const add = (label, match) => findings.push(`${file}: ${label}: ${match}`);
  for (const match of stripped.match(EMAIL) ?? []) add("email", match);
  for (const match of stripped.match(TAILSCALE_IP) ?? []) add("tailscale-ip", match);
  for (const match of stripped.match(TSNET) ?? []) {
    if (!ALLOWED_TSNET.has(match)) add("tailnet-host", match);
  }
  for (const match of stripped.match(SECRET_PREFIX) ?? []) add("secret-prefix", match);
  if (PRIVATE_KEY.test(stripped)) add("private-key", "private key block");
  for (const match of stripped.match(HOME_PATH) ?? []) add("home-path", match);
  const broadKill = new RegExp(`\\b${["pk", "ill"].join("")}\\b|\\b${["kill", "all"].join("")}\\b`);
  if (broadKill.test(stripped) && file.endsWith(".mjs")) add("broad-kill", "broad process kill");
  return findings;
}

export function scanTree(root = packageRoot) {
  const findings = [];
  for (const file of walk(root)) {
    const ext = path.extname(file).toLowerCase();
    const relative = path.relative(root, file);
    if (ext === ".png") {
      const chunk = pngHasTextChunk(readFileSync(file));
      if (chunk) findings.push(`${relative}: png text chunk ${chunk}`);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(ext) && path.basename(file) !== ".gitignore") continue;
    findings.push(...scanText(readFileSync(file, "utf8"), relative));
  }
  return findings;
}

if (process.argv[1]?.endsWith("privacy-scan.mjs")) {
  const findings = scanTree();
  if (findings.length > 0) {
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("privacy scan passed\n");
}
