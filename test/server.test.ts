import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildCatalog, loadSnapshotSpec } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import type { ToolCtx } from "../src/execute.js";

function ctx(): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: buildCatalog(loadSnapshotSpec()), client: new IRClient(cfg), readonly: false };
}

describe("createServer", () => {
  it("registers gateway + curated tools and lists them over MCP", async () => {
    const server = createServer(ctx());
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("ir_list_operations");
    expect(names).toContain("ir_describe_operation");
    expect(names).toContain("ir_call");
    expect(names).toContain("ir_ack_alert");
    expect(names.length).toBeGreaterThanOrEqual(25);
    await client.close();
  });
});
