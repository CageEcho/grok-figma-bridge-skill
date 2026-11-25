#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { packageRoot } from "../src/package-root.mjs";
import { applySourcePatch, assertBundledLoopback, assertManifestLoopback, sha256 } from "../src/harden-upstream.mjs";

const exec = promisify(execFile);
const pin = JSON.parse(readFileSync(path.join(packageRoot, "upstream.pin.json"), "utf8"));
const destination = path.resolve(process.argv[2] || path.join(packageRoot, "upstream", "figma-unified-mcp"));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function githubPath(remote) {
  try {
    const url = new URL(remote);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return "";
    return url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function isPinnedRepository(remote) {
  const pathName = githubPath(remote);
  return pathName === "/sso-ss/figma-unified-mcp" || pathName === "/sso-ss/figma-unified-mcp.git";
}

const safeEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: process.env.LANG || "C.UTF-8",
  GIT_TERMINAL_PROMPT: "0",
  npm_config_audit: "false",
  npm_config_fund: "false",
};

async function run(command, args, cwd) {
  await exec(command, args, { cwd, env: safeEnv, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
}

function readJsBundle(root) {
  const dist = path.join(root, "dist");
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else if (entry.endsWith(".js")) files.push(readFileSync(full, "utf8"));
    }
  };
  walk(dist);
  return files.join("\n");
}

async function headOf(cwd) {
  return (await exec("git", ["rev-parse", "HEAD"], { cwd, env: safeEnv })).stdout.trim();
}

if (existsSync(destination)) {
  const marker = path.join(destination, ".git");
  if (!existsSync(marker)) fail(`Refusing to replace ${destination} because it is not a git checkout.`);
  let remote = "";
  try {
    remote = (await exec("git", ["remote", "get-url", "origin"], { cwd: destination, env: safeEnv })).stdout.trim();
  } catch {
    fail("Refusing to use the existing checkout because its origin could not be read.");
  }
  if (!isPinnedRepository(remote)) {
    fail("Refusing to use a checkout whose origin is not the pinned upstream repository.");
  }
  await run("git", ["remote", "set-url", "origin", pin.repository], destination);
  const current = await headOf(destination);
  if (current !== pin.commit) {
    const dirty = (await exec("git", ["status", "--porcelain"], { cwd: destination, env: safeEnv })).stdout.trim();
    if (dirty) fail("Fail closed: checkout has local changes and is not on the pinned commit. Remove it and run again. Nothing was reset.");
    await run("git", ["-c", "core.autocrlf=false", "fetch", "--depth", "1", "origin", pin.commit], destination);
    await run("git", ["-c", "core.autocrlf=false", "checkout", "--detach", pin.commit], destination);
  }
} else {
  await run("git", ["-c", "core.autocrlf=false", "clone", "--no-checkout", pin.repository, destination]);
  await run("git", ["remote", "set-url", "origin", pin.repository], destination);
  await run("git", ["-c", "core.autocrlf=false", "fetch", "--depth", "1", "origin", pin.commit], destination);
  await run("git", ["-c", "core.autocrlf=false", "checkout", "--detach", pin.commit], destination);
}

const head = await headOf(destination);
if (head !== pin.commit) fail("Fail closed: HEAD does not match the pinned commit.");
const origin = (await exec("git", ["remote", "get-url", "origin"], { cwd: destination, env: safeEnv })).stdout.trim();
if (!isPinnedRepository(origin)) fail("Refusing to use a checkout whose origin is not the pinned upstream repository.");
await run("git", ["remote", "set-url", "origin", pin.repository], destination);

const packageJson = JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8"));
if (packageJson.name !== pin.packageName || packageJson.version !== pin.packageVersion) {
  fail("Fail closed: package name or version does not match the pin.");
}
if (packageJson.engines?.node !== pin.nodeEngine) fail("Fail closed: Node engine requirement does not match the pin.");
if (packageJson.license !== pin.license) fail("Fail closed: upstream license field does not match the pin.");

const sourcePath = path.join(destination, pin.sourceFile);
const sourceBytes = readFileSync(sourcePath);
const digest = sha256(sourceBytes);
let source = sourceBytes.toString("utf8");
if (digest === pin.unpatchedSha256) {
  const result = applySourcePatch(source, pin);
  if (!result.changed) fail("Fail closed: unpatched hash matched but the patch was not applied.");
  source = result.source;
  if (sha256(Buffer.from(source)) !== pin.patchedSha256) {
    fail("Fail closed: patched source hash does not match the pin.");
  }
  writeFileSync(sourcePath, source);
} else if (digest === pin.patchedSha256) {
  const result = applySourcePatch(source, pin);
  if (result.changed) fail("Fail closed: patched hash matched but the source still looked unpatched.");
} else {
  fail("Fail closed: plugin-bridge.ts hash does not match the pinned unpatched or patched file. Refusing to build.");
}

const manifest = JSON.parse(readFileSync(path.join(destination, pin.pluginManifest), "utf8"));
assertManifestLoopback(manifest);
if (!existsSync(path.join(destination, "figma-plugin", "code.js"))) {
  fail("Fail closed: figma-plugin/code.js is missing from the pinned checkout.");
}

await exec("npm", ["ci"], { cwd: destination, env: safeEnv, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
await exec("npm", ["run", "build"], { cwd: destination, env: safeEnv, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });

const entry = path.join(destination, pin.entry);
if (!existsSync(entry)) fail("Fail closed: dist/server.js was not produced.");
assertBundledLoopback(readJsBundle(destination));
process.stdout.write(`Upstream ${pin.commit} is patched so WebSocket port ${pin.wsPort} binds 127.0.0.1, then built.\n`);
process.stdout.write(`Entry: ${entry}\n`);
