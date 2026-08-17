import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";
import type { Config } from "./config.js";
import { IRClient } from "./client.js";
import { buildCatalog, loadSpec } from "./openapi/catalog.js";
import { registerGatewayTools } from "./tools/gateway.js";
import { registerCuratedTools } from "./tools/curated.js";
import type { ToolCtx } from "./execute.js";

export function createServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerGatewayTools(server, ctx);
  registerCuratedTools(server, ctx);
  return server;
}

export async function buildContext(cfg: Config): Promise<{ ctx: ToolCtx; source: "live" | "snapshot" }> {
  const { spec, source } = await loadSpec({ openapiUrl: cfg.openapiUrl, timeoutMs: cfg.timeoutMs });
  const ctx: ToolCtx = { catalog: buildCatalog(spec), client: new IRClient(cfg), readonly: cfg.readonly };
  return { ctx, source };
}
