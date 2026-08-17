#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildContext, createServer } from "./server.js";
import { startHttp } from "./http.js";

async function main() {
  const cfg = loadConfig(process.argv.slice(2), process.env);
  if (!cfg.verifyTls) {
    process.stderr.write(
      "[incidentrelay-mcp] WARNING: TLS verification is DISABLED (IR_VERIFY_TLS=false). " +
        "This exposes traffic to MITM attacks. Prefer adding the server CA to your trust store.\n"
    );
  }
  const { ctx, source } = await buildContext(cfg);
  process.stderr.write(
    `[incidentrelay-mcp] catalog loaded from ${source} (${ctx.catalog.size} operations); ` +
      `readonly=${cfg.readonly} transport=${cfg.transport}\n`
  );

  if (cfg.transport === "http") {
    const handle = await startHttp(cfg, () => createServer(ctx));
    process.stderr.write(`[incidentrelay-mcp] listening on http://${cfg.host}:${handle.port}/mcp\n`);
  } else {
    const server = createServer(ctx);
    await server.connect(new StdioServerTransport());
    process.stderr.write(`[incidentrelay-mcp] stdio transport connected\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`[incidentrelay-mcp] fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
