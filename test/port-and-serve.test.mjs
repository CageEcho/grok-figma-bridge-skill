import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { findListeners } from "../src/port-holders.mjs";
import { assertServeStatusIsPrivate, buildServeArgs, buildServeOffArgs } from "../src/tailscale-serve.mjs";

test("listener lookup reports this process and no other pid", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const listeners = findListeners(port);
    assert.ok(listeners.some((listener) => listener.pid === process.pid && listener.loopbackOnly));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("tailscale helper builds serve arguments and rejects funnel status", () => {
  assert.deepEqual(buildServeArgs(3847), ["serve", "--bg", "--https=443", "http://127.0.0.1:3847"]);
  assert.deepEqual(buildServeOffArgs(), ["serve", "--https=443", "off"]);
  assert.throws(() => buildServeArgs(0), /port/);
  assert.throws(() => assertServeStatusIsPrivate("Funnel is enabled"), /Funnel/);
  assert.doesNotThrow(() => assertServeStatusIsPrivate("https://YOUR_DEVICE.YOUR_TAILNET.ts.net (tailnet only)\n|-- / proxy http://127.0.0.1:3847\n"));
});
