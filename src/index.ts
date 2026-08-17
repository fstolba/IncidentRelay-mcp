#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildSnapshotContext, refreshCatalogFromLive, createServer } from "./server.js";
import { startHttp } from "./http.js";
import type { ToolCtx } from "./execute.js";
import type { Config } from "./config.js";

function log(msg: string) {
  process.stderr.write(`[incidentrelay-mcp] ${msg}\n`);
}

async function main() {
  const cfg = loadConfig(process.argv.slice(2), process.env);
  if (!cfg.verifyTls) {
    log(
      "WARNING: TLS verification is DISABLED (IR_VERIFY_TLS=false). " +
        "This exposes traffic to MITM attacks. Prefer adding the server CA to your trust store."
    );
  }

  // Start from the bundled snapshot so the transport connects and the MCP
  // handshake completes immediately — never blocking on a network fetch.
  const ctx: ToolCtx = buildSnapshotContext(cfg);

  await connectTransport(cfg, ctx);
  log(`started (snapshot catalog, ${ctx.catalog.size} operations); readonly=${cfg.readonly} transport=${cfg.transport}`);

  // Refresh the catalog from the live server in the background; tools read
  // ctx.catalog at call time, so the swap is picked up transparently.
  refreshCatalogFromLive(ctx, cfg)
    .then((source) => {
      if (source === "live") log(`catalog refreshed from live (${ctx.catalog.size} operations)`);
      else log("live OpenAPI unreachable; continuing with bundled snapshot catalog");
    })
    .catch((e) => log(`catalog refresh failed: ${(e as Error).message}; using bundled snapshot`));
}

async function connectTransport(cfg: Config, ctx: ToolCtx): Promise<void> {
  if (cfg.transport === "http") {
    const handle = await startHttp(cfg, () => createServer(ctx));
    log(`listening on http://${cfg.host}:${handle.port}/mcp`);
  } else {
    const server = createServer(ctx);
    await server.connect(new StdioServerTransport());
    log("stdio transport connected");
  }
}

main().catch((e) => {
  log(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
