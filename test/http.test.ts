import { describe, it, expect, afterEach } from "vitest";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildCatalog, loadSnapshotSpec } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { startHttp } from "../src/http.js";
import type { Config } from "../src/config.js";
import type { ToolCtx } from "../src/execute.js";

const cfg: Config = { baseUrl: "https://ir.example.com", token: "t", transport: "http", port: 0, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };

function ctx(): ToolCtx {
  return { catalog: buildCatalog(loadSnapshotSpec()), client: new IRClient(cfg), readonly: false };
}

let handle: { close: () => Promise<void>; port: number } | undefined;
afterEach(async () => { if (handle) await handle.close(); handle = undefined; });

describe("startHttp", () => {
  it("serves MCP over streamable HTTP", async () => {
    handle = await startHttp({ ...cfg, port: 0 }, () => createServer(ctx()));
    const client = new Client({ name: "test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`));
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("ir_call");
    await client.close();
  });
});
