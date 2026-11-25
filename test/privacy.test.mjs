import assert from "node:assert/strict";
import test from "node:test";
import { scanText, scanTree } from "../scripts/privacy-scan.mjs";

test("privacy scanner catches an email and accepts this tree", () => {
  const email = ["person", "example.com"].join("@");
  const address = ["100", "1", "2", "3"].join(".");
  const findings = scanText(`contact ${email} about ${address}`, "sample.txt");
  assert.ok(findings.some((line) => line.includes("email")));
  assert.ok(findings.some((line) => line.includes("tailscale-ip")));
  assert.deepEqual(scanTree(), []);
});
