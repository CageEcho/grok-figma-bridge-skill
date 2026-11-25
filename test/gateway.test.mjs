import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { packageRoot } from "../src/package-root.mjs";
import { startGateway } from "../src/gateway.mjs";

const TOKEN = "synthetic-test-token-do-not-use-0123456789abcd";
const WRONG = "synthetic-wrong-token-do-not-use-0123456789abcd";
const MOCK = path.join(packageRoot, "test", "fixtures", "mock-stdio-server.mjs");

function runtimeDir() {
  return mkdtempSync(path.join(tmpdir(), "grok-figma-bridge-"));
}

function gatewayOptions(dir, extra = {}) {
  return {
    GROK_FIGMA_BRIDGE_TOKEN: TOKEN,
    GROK_FIGMA_BRIDGE_PORT: "0",
    GROK_FIGMA_BRIDGE_UPSTREAM_ENTRY: MOCK,
    GROK_FIGMA_BRIDGE_RUNTIME_DIR: dir,
    GROK_FIGMA_BRIDGE_EXPECT_WS: "0",
    GROK_FIGMA_BRIDGE_CONFIG: path.join(dir, "absent.env"),
    GROK_FIGMA_BRIDGE_ALLOWED_HOSTS: "example.ts.net",
    ...extra,
  };
}

async function withGateway(extra, fn) {
  const dir = runtimeDir();
  const gateway = await startGateway(gatewayOptions(dir, extra));
  try {
    await fn(gateway, dir);
  } finally {
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("unauthenticated and wrong-token requests match and do not echo the token", async () => {
  await withGateway({}, async (gateway) => {
    const missing = await fetch(gateway.url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const wrong = await fetch(gateway.url, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", authorization: `Bearer ${WRONG}` },
    });
    const missingBody = await missing.text();
    const wrongBody = await wrong.text();
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(missingBody, wrongBody);
    assert.equal(missingBody.includes(TOKEN), false);
    assert.equal(missingBody.includes(WRONG), false);
    assert.match(missing.headers.get("www-authenticate") || "", /Bearer/);
    const query = await fetch(`${gateway.url}?access_token=${TOKEN}`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(query.status, 401);
    const otherPath = await fetch(gateway.url.replace("/mcp", "/secret"), {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(otherPath.status, 404);
  });
});

function postRaw(port, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ?? "";
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

test("host and origin guards reject unexpected names", async () => {
  await withGateway({}, async (gateway) => {
    const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", host: "evil.example" };
    const badHost = await postRaw(gateway.port, headers, "{}");
    assert.equal(badHost.status, 403);
    assert.equal(badHost.body.includes(TOKEN), false);
    const badOrigin = await postRaw(
      gateway.port,
      { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", origin: "https://evil.example" },
      "{}",
    );
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.body.includes(TOKEN), false);
    const allowed = await postRaw(
      gateway.port,
      {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        host: "example.ts.net",
        origin: "https://example.ts.net",
      },
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    );
    assert.notEqual(allowed.status, 403);
    assert.notEqual(allowed.status, 401);
  });
});

test("official client can initialize, list tools, and call the mock", async () => {
  await withGateway({}, async (gateway) => {
    const transport = new StreamableHTTPClientTransport(new URL(gateway.url), {
      authProvider: { token: async () => TOKEN },
    });
    const client = new Client({ name: "synthetic-test-client", version: "0.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      assert.ok(listed.tools.some((tool) => tool.name === "bridge_echo"));
      const result = await client.callTool({ name: "bridge_echo", arguments: { message: "ping" } });
      assert.match(JSON.stringify(result), /echo:ping/);
    } finally {
      await client.close();
    }
    const again = new Client({ name: "synthetic-test-client", version: "0.0.0" });
    const secondTransport = new StreamableHTTPClientTransport(new URL(gateway.url), {
      authProvider: { token: async () => TOKEN },
    });
    await again.connect(secondTransport);
    try {
      const result = await again.callTool({ name: "bridge_echo", arguments: { message: "again" } });
      assert.match(JSON.stringify(result), /echo:again/);
    } finally {
      await again.close();
    }
  });
});

function spawnGateway(dir, extraEnv = {}) {
  return spawn(process.execPath, [path.join(packageRoot, "src", "gateway.mjs")], {
    cwd: packageRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      FIGMA_ACCESS_TOKEN: "synthetic-figma-token-should-not-leak",
      GROK_FIGMA_BRIDGE_TOKEN: TOKEN,
      GROK_FIGMA_BRIDGE_PORT: "0",
      GROK_FIGMA_BRIDGE_UPSTREAM_ENTRY: MOCK,
      GROK_FIGMA_BRIDGE_RUNTIME_DIR: dir,
      GROK_FIGMA_BRIDGE_EXPECT_WS: "0",
      GROK_FIGMA_BRIDGE_CONFIG: path.join(dir, "absent.env"),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitReady(dir, child) {
  const readyPath = path.join(dir, "ready.json");
  const started = Date.now();
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  while (Date.now() - started < 8000) {
    if (child.exitCode != null) throw new Error(output || "gateway exited");
    try {
      return { ready: JSON.parse(readFileSync(readyPath, "utf8")), output: () => output };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`timed out waiting for gateway: ${output}`);
}

test("second process reports the running pid and the child env excludes secrets", async () => {
  const dir = runtimeDir();
  const first = spawnGateway(dir);
  try {
    const { ready, output } = await waitReady(dir, first);
    const second = spawnGateway(dir, { GROK_FIGMA_BRIDGE_PORT: "0" });
    const secondResult = await new Promise((resolve) => {
      let text = "";
      second.stderr.on("data", (chunk) => {
        text += chunk.toString("utf8");
      });
      second.stdout.on("data", (chunk) => {
        text += chunk.toString("utf8");
      });
      second.on("exit", (code) => resolve({ code, text }));
    });
    assert.notEqual(secondResult.code, 0);
    assert.match(secondResult.text, new RegExp(`PID ${ready.pid}`));
    assert.equal(secondResult.text.includes(TOKEN), false);
    const log = readFileSync(path.join(dir, "gateway.log"), "utf8");
    assert.match(log, /figma_access_token=absent/);
    assert.match(log, /gateway_token=absent/);
    assert.equal(log.includes(TOKEN), false);
    assert.equal(log.includes("synthetic-figma-token-should-not-leak"), false);
    assert.equal(output().includes(TOKEN), false);
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ready.port}/mcp`), {
      authProvider: { token: async () => TOKEN },
    });
    const client = new Client({ name: "synthetic-test-client", version: "0.0.0" });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 1);
    await client.close();
  } finally {
    first.kill("SIGTERM");
    await new Promise((resolve) => first.on("exit", resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stopping the gateway also stops the mock backend", async () => {
  const dir = runtimeDir();
  const child = spawnGateway(dir);
  const { ready } = await waitReady(dir, child);
  child.kill("SIGTERM");
  await new Promise((resolve) => child.on("exit", resolve));
  await new Promise((resolve) => setTimeout(resolve, 200));
  let backendAlive = true;
  try {
    process.kill(ready.backendPid, 0);
  } catch {
    backendAlive = false;
  }
  assert.equal(backendAlive, false);
  rmSync(dir, { recursive: true, force: true });
});

test("an occupied websocket port is reported and left running", async () => {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(18211, "127.0.0.1", resolve));
  const dir = runtimeDir();
  const child = spawnGateway(dir, { GROK_FIGMA_BRIDGE_EXPECT_WS: "1", GROK_FIGMA_BRIDGE_PORT: "0" });
  try {
    const result = await new Promise((resolve) => {
      let text = "";
      child.stderr.on("data", (chunk) => {
        text += chunk.toString("utf8");
      });
      child.on("exit", (code) => resolve({ code, text }));
    });
    assert.notEqual(result.code, 0);
    assert.match(result.text, new RegExp(`PID ${process.pid}`));
    assert.match(result.text, /18211/);
    assert.equal(result.text.includes(TOKEN), false);
    await new Promise((resolve, reject) => blocker.getConnections((error, count) => (error ? reject(error) : resolve(count))));
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
