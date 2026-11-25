#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/package-root.mjs";
import { scanText } from "./privacy-scan.mjs";

const rootFiles = [
  ".gitignore",
  "LICENSE",
  "README.md",
  "README.en.md",
  "SKILL.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "package-lock.json",
  "upstream.pin.json",
];

function listedFiles() {
  const files = rootFiles.filter((file) => existsSync(path.join(packageRoot, file)));
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(packageRoot, dir))) {
      const relative = path.join(dir, entry);
      const full = path.join(packageRoot, relative);
      if (statSync(full).isDirectory()) walk(relative);
      else files.push(relative.split(path.sep).join("/"));
    }
  };
  for (const dir of ["docs", "src", "scripts", "templates", "test"]) walk(dir);
  return files.sort();
}

const files = listedFiles();
const findings = [];
for (const file of files) {
  if (file.endsWith(".png")) continue;
  findings.push(...scanText(readFileSync(path.join(packageRoot, file), "utf8"), file));
}
if (findings.length > 0) {
  process.stderr.write(`${findings.join("\n")}\n`);
  process.exit(1);
}

const outputDir = path.join(packageRoot, "artifacts");
mkdirSync(outputDir, { recursive: true });
const zipPath = path.join(outputDir, "grok-figma-bridge-skill.zip");
rmSync(zipPath, { force: true });
execFileSync("zip", ["-X", "-q", zipPath, ...files], { cwd: packageRoot });
const listing = execFileSync("unzip", ["-l", zipPath], { encoding: "utf8" });
const names = listing
  .split("\n")
  .map((line) => line.trim().split(/\s+/).at(-1) || "")
  .filter((name) => name && !name.endsWith(":"));
for (const name of names) {
  if (name.includes("node_modules") || name.startsWith("upstream/") || name.includes("/.env") || name.endsWith(".env")) {
    process.stderr.write(`Zip listing failed the safety check: ${name}\n`);
    process.exit(1);
  }
}
writeFileSync(path.join(outputDir, "zip-listing.txt"), listing);
process.stdout.write(`Wrote ${zipPath}\n`);
