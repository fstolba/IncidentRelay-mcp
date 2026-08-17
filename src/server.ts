import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";
import type { Config } from "./config.js";
import { IRClient } from "./client.js";
import { buildCatalog, loadSnapshotSpec, loadSpec } from "./openapi/catalog.js";
import { registerGatewayTools } from "./tools/gateway.js";
import { registerCuratedTools } from "./tools/curated.js";
import type { ToolCtx } from "./execute.js";

export function createServer(ctx: ToolCtx): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerGatewayTools(server, ctx);
  registerCuratedTools(server, ctx);
  return server;
}

/**
 * Build a tool context from the bundled snapshot synchronously — no network.
 * This lets the server connect its transport and answer the MCP handshake
 * immediately, instead of blocking startup on a live OpenAPI fetch.
 */
export function buildSnapshotContext(cfg: Config): ToolCtx {
  return {
    catalog: buildCatalog(loadSnapshotSpec()),
    client: new IRClient(cfg),
    readonly: cfg.readonly,
  };
}

/**
 * Best-effort refresh of the operation catalog from the live server, so the
 * server tracks the deployed IncidentRelay version. Swaps `ctx.catalog` in
 * place on success (tools read `ctx.catalog` at call time). Bounded so a slow
 * endpoint never leaves a background task hanging.
 */
export async function refreshCatalogFromLive(ctx: ToolCtx, cfg: Config): Promise<"live" | "snapshot"> {
  const timeoutMs = Math.min(cfg.timeoutMs, 10000);
  const { spec, source } = await loadSpec({ openapiUrl: cfg.openapiUrl, timeoutMs });
  if (source === "live") ctx.catalog = buildCatalog(spec);
  return source;
}
