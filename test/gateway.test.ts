import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildCatalog } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { registerGatewayTools } from "../src/tools/gateway.js";
import type { ToolCtx } from "../src/execute.js";

const SPEC = {
  paths: {
    "/api/alerts": { get: { operationId: "listAlertGroups", tags: ["alerts"], summary: "List alerts" } },
  },
};

function makeCtx(): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: buildCatalog(SPEC), client: new IRClient(cfg), readonly: false };
}

describe("gateway registration", () => {
  it("registers the three gateway tools without throwing", () => {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    expect(() => registerGatewayTools(server, makeCtx())).not.toThrow();
    expect(() => registerGatewayTools(new McpServer({ name: "t2", version: "0.0.0" }), makeCtx())).not.toThrow();
  });
});
