import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

function paramsOf(request) {
  if (!request || typeof request !== "object") return {};
  if (typeof request.method === "string") return request.params ?? {};
  return request;
}

export function buildChildEnv(wsPort = 18211) {
  return { FIGMA_WS_PORT: String(wsPort) };
}

export async function startBackend({ entry, callTimeoutMs, onStderr, onExit }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: entry.endsWith(`${path.sep}dist${path.sep}server.js`) ? path.dirname(path.dirname(entry)) : path.dirname(entry),
    env: buildChildEnv(),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    onStderr?.(chunk.toString("utf8"));
  });
  transport.onclose = () => {
    onExit?.();
  };
  const client = new Client({ name: "grok-figma-bridge-gateway", version: "1.0.0" });
  await client.connect(transport);
  return {
    pid: transport.pid,
    capabilities() {
      return client.getServerCapabilities() ?? {};
    },
    listTools(params) {
      return client.listTools(params?.cursor ? { cursor: params.cursor } : undefined);
    },
    callTool(params) {
      return client.callTool(params, { timeout: callTimeoutMs });
    },
    listPrompts(params) {
      return client.listPrompts(params?.cursor ? { cursor: params.cursor } : undefined);
    },
    getPrompt(params) {
      return client.getPrompt(params, { timeout: callTimeoutMs });
    },
    listResources(params) {
      return client.listResources(params?.cursor ? { cursor: params.cursor } : undefined);
    },
    readResource(params) {
      return client.readResource(params, { timeout: callTimeoutMs });
    },
    async close() {
      try {
        await client.close();
      } catch {
        // The child may already be gone.
      }
      try {
        await transport.close();
      } catch {
        // close() is idempotent for our shutdown path.
      }
    },
  };
}

export function createFacade(backend, Server) {
  const remote = backend.capabilities();
  const capabilities = {};
  if (remote.tools) capabilities.tools = {};
  if (remote.prompts) capabilities.prompts = {};
  if (remote.resources) capabilities.resources = {};
  const server = new Server(
    { name: "grok-figma-bridge-gateway", version: "1.0.0" },
    {
      capabilities,
      instructions:
        "Authenticated local gateway in front of one stdio MCP backend. Not an official Figma server. Do not send passwords or access tokens to tools.",
    },
  );
  if (capabilities.tools) {
    server.setRequestHandler("tools/list", async (request) => {
      const params = paramsOf(request);
      return backend.listTools(params.cursor ? { cursor: params.cursor } : undefined);
    });
    server.setRequestHandler("tools/call", async (request) => {
      const params = paramsOf(request);
      if (!params || typeof params.name !== "string") {
        throw new Error("tools/call is missing a tool name.");
      }
      return backend.callTool({ name: params.name, arguments: params.arguments ?? {} });
    });
  }
  if (capabilities.prompts) {
    server.setRequestHandler("prompts/list", async (request) => {
      const params = paramsOf(request);
      return backend.listPrompts(params.cursor ? { cursor: params.cursor } : undefined);
    });
    server.setRequestHandler("prompts/get", async (request) => backend.getPrompt(paramsOf(request)));
  }
  if (capabilities.resources) {
    server.setRequestHandler("resources/list", async (request) => {
      const params = paramsOf(request);
      return backend.listResources(params.cursor ? { cursor: params.cursor } : undefined);
    });
    server.setRequestHandler("resources/read", async (request) => backend.readResource(paramsOf(request)));
  }
  return server;
}
