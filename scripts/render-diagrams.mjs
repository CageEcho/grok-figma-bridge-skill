#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/package-root.mjs";

const chrome = process.env.CHROME || "google-chrome";
const jobs = [
  ["docs/diagrams/architecture-en.html", "docs/images/architecture-shortest-path-en.png", "1280,900"],
  ["docs/diagrams/architecture-zh.html", "docs/images/architecture-shortest-path-zh.png", "1280,900"],
  ["docs/diagrams/setup-en.html", "docs/images/setup-and-panel-rule-en.png", "1280,860"],
  ["docs/diagrams/setup-zh.html", "docs/images/setup-and-panel-rule-zh.png", "1280,860"],
];

for (const [html, png, size] of jobs) {
  const output = path.join(packageRoot, png);
  try {
    execFileSync(
      "timeout",
      [
        "--kill-after=5",
        "20",
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--virtual-time-budget=2000",
        "--timeout=3000",
        `--window-size=${size}`,
        `--screenshot=${output}`,
        `file://${path.join(packageRoot, html)}`,
      ],
      { stdio: "inherit" },
    );
  } catch (error) {
    const written = existsSync(output) && statSync(output).size > 1000;
    if (error?.status !== 124 || !written) throw error;
  }
  process.stdout.write(`rendered ${png}\n`);
}
