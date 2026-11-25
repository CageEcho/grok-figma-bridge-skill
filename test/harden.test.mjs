import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "../src/package-root.mjs";
import { applySourcePatch, assertBundledLoopback, assertManifestLoopback } from "../src/harden-upstream.mjs";

const pin = JSON.parse(readFileSync(path.join(packageRoot, "upstream.pin.json"), "utf8"));

test("source patch is idempotent and fail-closed", () => {
  const unpatched = `before\n${pin.unpatchedLine}\nafter\n`;
  const once = applySourcePatch(unpatched, pin);
  assert.equal(once.changed, true);
  assert.equal(once.source.includes(pin.patchedLine), true);
  assert.equal(once.source.includes("new WebSocketServer({ port: this.port })"), false);
  const twice = applySourcePatch(once.source, pin);
  assert.equal(twice.changed, false);
  assert.throws(() => applySourcePatch("new WebSocketServer({ port: 1 });\n", pin), /Fail closed/);
  assert.throws(
    () => applySourcePatch(`${pin.unpatchedLine}\n${pin.unpatchedLine}\n`, pin),
    /exactly one WebSocketServer/,
  );
});

test("bundle check accepts only a loopback host", () => {
  assert.doesNotThrow(() =>
    assertBundledLoopback('start(); new WebSocketServer({port:this.port,host:"127.0.0.1"}); end();'),
  );
  assert.throws(
    () => assertBundledLoopback("new WebSocketServer({ port: this.port });"),
    /127\.0\.0\.1/,
  );
  assert.throws(() => assertBundledLoopback("no server"), /exactly one/);
});

test("manifest check rejects non-loopback domains", () => {
  assert.doesNotThrow(() =>
    assertManifestLoopback({ networkAccess: { allowedDomains: ["ws://localhost:18211"] } }),
  );
  assert.throws(
    () => assertManifestLoopback({ networkAccess: { allowedDomains: ["https://example.com"] } }),
    /non-loopback/,
  );
});
