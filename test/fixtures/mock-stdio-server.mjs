#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const figma = Object.prototype.hasOwnProperty.call(process.env, "FIGMA_ACCESS_TOKEN");
const gateway = Object.prototype.hasOwnProperty.call(process.env, "GROK_FIGMA_BRIDGE_TOKEN");
process.stderr.write(
  `synthetic-env-report figma_access_token=${figma ? "present" : "absent"} gateway_token=${gateway ? "present" : "absent"}\n`,
);

const server = new Server(
  { name: "synthetic-mock-stdio", version: "0.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "bridge_echo",
      description: "Synthetic fixture tool. Not Figma and not a network call.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
    },
  ],
}));
server.setRequestHandler("tools/call", async (request) => {
  const params = request && typeof request.method === "string" ? (request.params ?? {}) : (request ?? {});
  const message = params.arguments?.message ?? "";
  return { content: [{ type: "text", text: `echo:${message}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
