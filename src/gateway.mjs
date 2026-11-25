import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, hostHeaderValidation, originValidation } from "@modelcontextprotocol/node";
import { bearerMatches, extractBearer } from "./auth.mjs";
import { createFacade, startBackend } from "./backend.mjs";
import { resolveConfig } from "./config.mjs";
import { isLoopbackAddress } from "./hosts.mjs";
import { acquireLock, releaseLock } from "./lock.mjs";
import { assertExclusiveLoopback, assertPortFree, processCommand } from "./port-holders.mjs";
import { redact } from "./redact.mjs";

const UNAUTHORIZED = { error: "unauthorized" };
const SHUTDOWN_GRACE_MS = 5000;

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("body too large");
        error.code = "BODY_LIMIT";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("bad json");
        error.code = "BAD_JSON";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function isInitialize(body) {
  return Boolean(body) && !Array.isArray(body) && body.method === "initialize";
}

async function waitForExit(pid, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function startGateway(options = {}) {
  const config = resolveConfig({ options });
  const secrets = [config.token];
  mkdirSync(config.runtimeDir, { recursive: true });
  chmodSync(config.runtimeDir, 0o700);
  const logPath = path.join(config.runtimeDir, "gateway.log");
  writeFileSync(logPath, "", { flag: "a", mode: 0o600 });
  chmodSync(logPath, 0o600);
  let logBytes = 0;
  const log = (message) => {
    if (logBytes > 1024 * 1024) return;
    const line = `${new Date().toISOString()} ${redact(message, secrets)}\n`;
    logBytes += line.length;
    appendFileSync(logPath, line);
  };

  const lockPath = acquireLock(config.runtimeDir, { startedAt: new Date().toISOString() });
  let backend = null;
  let httpServer = null;
  let facade = null;
  let transport = null;
  let shuttingDown = false;
  let inflight = 0;
  let lastUsed = Date.now();
  let exitCode = 0;
  let backendExitExpected = false;
  let sessionChain = Promise.resolve();

  const validateHost = hostHeaderValidation(config.allowedHosts);
  const validateOrigin = originValidation(config.allowedHosts);

  function sessionExclusive(task) {
    const run = sessionChain.then(task, task);
    sessionChain = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async function closeFacade() {
    const currentServer = facade;
    const currentTransport = transport;
    facade = null;
    transport = null;
    try {
      await currentServer?.close();
    } catch {
      // The HTTP session may already be closed.
    }
    try {
      await currentTransport?.close();
    } catch {
      // Closing the server usually closes the transport too.
    }
  }

  function ensureFacade() {
    return sessionExclusive(async () => {
      if (transport) return transport;
      facade = createFacade(backend, Server);
      transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessionclosed: () => {
          facade = null;
          transport = null;
        },
      });
      await facade.connect(transport);
      return transport;
    });
  }

  async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    backendExitExpected = true;
    clearInterval(idleTimer);
    try {
      if (httpServer) {
        httpServer.closeAllConnections?.();
        await new Promise((resolve) => httpServer.close(() => resolve()));
      }
    } catch {
      // The listener may not have started.
    }
    await sessionExclusive(() => closeFacade());
    const backendPid = backend?.pid ?? null;
    try {
      await backend?.close();
    } catch {
      // The stdio child is stopped below if it is still our process.
    }
    if (backendPid && !(await waitForExit(backendPid, SHUTDOWN_GRACE_MS))) {
      const command = processCommand(backendPid);
      if (command.includes("server.js") || command.includes("mock-stdio-server.mjs")) {
        try {
          process.kill(backendPid, "SIGKILL");
        } catch {
          // The pid may have exited between the check and the signal.
        }
      } else {
        log(`backend PID ${backendPid} is still alive but its command does not match the spawned entry; not signaling it`);
      }
    }
    const readyPath = path.join(config.runtimeDir, "ready.json");
    if (existsSync(readyPath)) unlinkSync(readyPath);
    releaseLock(lockPath);
    log(`gateway stopped code=${code}`);
  }

  const idleTimer = setInterval(() => {
    if (shuttingDown || inflight > 0 || !transport) return;
    if (Date.now() - lastUsed < config.sessionIdleMs) return;
    void closeFacade().catch((error) => log(`session idle close failed: ${error instanceof Error ? error.message : "error"}`));
  }, Math.min(config.sessionIdleMs, 60_000));
  idleTimer.unref?.();

  try {
    if (config.port !== 0) assertPortFree(config.port);
    if (config.expectWs) assertPortFree(config.wsPort);
    backend = await startBackend({
      entry: config.upstreamEntry,
      callTimeoutMs: config.callTimeoutMs,
      onStderr: (text) => log(`backend stderr: ${text.trim()}`),
      onExit: () => {
        if (backendExitExpected || shuttingDown) return;
        log("stdio backend exited");
        void shutdown(1).then(() => {
          if (isDirectRun()) process.exit(1);
        });
      },
    });
    if (!backend.pid) throw new Error("Stdio backend did not report a PID. Fail closed.");
    if (config.expectWs) {
      let ready = false;
      let lastError = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          assertExclusiveLoopback(config.wsPort, backend.pid);
          ready = true;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (!ready) throw lastError;
    }

    httpServer = createServer(async (req, res) => {
      try {
        if (shuttingDown) {
          sendJson(res, 503, { error: "shutting down" });
          return;
        }
        if (!isLoopbackAddress(req.socket.remoteAddress)) {
          req.resume();
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        if (!validateHost(req, res) || !validateOrigin(req, res)) {
          req.resume();
          return;
        }
        const presented = extractBearer(req.headers.authorization);
        if (!presented || !bearerMatches(presented, config.token)) {
          req.resume();
          sendJson(res, 401, UNAUTHORIZED, {
            "WWW-Authenticate": 'Bearer realm="grok-figma-bridge", error="invalid_token"',
          });
          return;
        }
        let url;
        try {
          url = new URL(req.url || "/", "http://127.0.0.1");
        } catch {
          sendJson(res, 400, { error: "bad request" });
          return;
        }
        if (url.searchParams.has("token") || url.searchParams.has("access_token")) {
          sendJson(res, 401, UNAUTHORIZED);
          return;
        }
        if (url.pathname !== "/mcp") {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        if (inflight >= config.maxInflight) {
          sendJson(res, 429, { error: "too many requests" });
          return;
        }
        let parsedBody;
        if (req.method === "POST") {
          const type = String(req.headers["content-type"] || "");
          if (type && !type.startsWith("application/json")) {
            sendJson(res, 415, { error: "unsupported media type" });
            return;
          }
          try {
            parsedBody = await readBody(req, config.bodyLimit);
          } catch (error) {
            if (error?.code === "BODY_LIMIT") sendJson(res, 413, { error: "payload too large" });
            else sendJson(res, 400, { error: "bad request" });
            return;
          }
        }
        inflight += 1;
        lastUsed = Date.now();
        try {
          if (isInitialize(parsedBody) && !req.headers["mcp-session-id"]) {
            await sessionExclusive(() => closeFacade());
          }
          const active = await ensureFacade();
          await active.handleRequest(req, res, parsedBody);
        } finally {
          inflight -= 1;
          lastUsed = Date.now();
        }
      } catch (error) {
        log(`request failed: ${error instanceof Error ? error.message : "error"}`);
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      }
    });
    httpServer.requestTimeout = config.callTimeoutMs + 5000;
    httpServer.headersTimeout = 10_000;
    httpServer.keepAliveTimeout = 5000;
    httpServer.maxHeadersCount = 50;
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      httpServer.once("error", onError);
      httpServer.listen(config.port, "127.0.0.1", () => {
        httpServer.off("error", onError);
        resolve();
      });
    });
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : config.port;
    const ready = {
      pid: process.pid,
      backendPid: backend.pid,
      port,
      host: "127.0.0.1",
      path: "/mcp",
      expectWs: config.expectWs,
    };
    const readyPath = path.join(config.runtimeDir, "ready.json");
    writeFileSync(readyPath, `${JSON.stringify(ready)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(readyPath, 0o600);
    log(`listening http://127.0.0.1:${port}/mcp backendPid=${backend.pid} expectWs=${config.expectWs}`);
    return {
      port,
      url: `http://127.0.0.1:${port}/mcp`,
      pid: process.pid,
      backendPid: backend.pid,
      runtimeDir: config.runtimeDir,
      stop: () => shutdown(exitCode),
    };
  } catch (error) {
    log(`startup failed: ${error instanceof Error ? error.message : "error"}`);
    await shutdown(1);
    throw error;
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  let gateway;
  const stop = (code) => {
    const done = gateway ? gateway.stop() : Promise.resolve();
    done.finally(() => process.exit(code));
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  startGateway()
    .then((started) => {
      gateway = started;
      process.stdout.write(`listening http://127.0.0.1:${started.port}/mcp\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Gateway failed to start."}\n`);
      process.exit(1);
    });
}
