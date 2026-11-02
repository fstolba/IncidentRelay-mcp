import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { buildCatalog, loadSnapshotSpec } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { CURATED_TOOLS } from "../src/tools/curated.js";
import { executeOperation, type ToolCtx } from "../src/execute.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const realCatalog = buildCatalog(loadSnapshotSpec());

function ctx(): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly: false, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: realCatalog, client: new IRClient(cfg), readonly: false };
}

describe("curated tool specs", () => {
  it("every curated tool maps to a real operationId in the snapshot", () => {
    for (const t of CURATED_TOOLS) {
      expect(realCatalog.get(t.operationId), `${t.name} -> ${t.operationId}`).toBeDefined();
    }
  });

  it("all curated names are ir_ prefixed and unique", () => {
    const names = CURATED_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.startsWith("ir_"))).toBe(true);
  });

  it("ir_ack_alert maps args to the ack operation", async () => {
    server.use(
      http.post("https://ir.example.com/api/alert-groups/42/acknowledge", () => HttpResponse.json({ status: "acknowledged" }))
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_ack_alert")!;
    const r = await executeOperation(ctx(), tool.map({ alert_id: 42 }));
    expect(r.content[0].text).toContain("acknowledged");
  });

  it("ir_list_alerts passes filters as query", async () => {
    server.use(
      http.get("https://ir.example.com/api/alert-groups", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("status")).toBe("firing");
        return HttpResponse.json({ items: [] });
      })
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_list_alerts")!;
    const r = await executeOperation(ctx(), tool.map({ status: "firing" }));
    expect(r.isError).toBeFalsy();
  });

  it("ir_comment_alert posts to the v2.3 comment endpoint with a body field", async () => {
    server.use(
      http.post("https://ir.example.com/api/alert-groups/42/comments", async ({ request }) => {
        expect(await request.json()).toEqual({ body: "investigating" });
        return HttpResponse.json({ id: 1 });
      })
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_comment_alert")!;
    const r = await executeOperation(ctx(), tool.map({ alert_id: 42, comment: "investigating" }));
    expect(r.isError).toBeFalsy();
  });

  it("ir_ack_alert posts to the v2.3 acknowledge endpoint", async () => {
    server.use(
      http.post("https://ir.example.com/api/alert-groups/9/acknowledge", async ({ request }) => {
        expect(await request.json()).toEqual({ user_id: 2 });
        return HttpResponse.json({ status: "acknowledged" });
      })
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_ack_alert")!;
    const r = await executeOperation(ctx(), tool.map({ alert_id: 9, user_id: 2 }));
    expect(r.isError).toBeFalsy();
  });

  it("ir_create_incident posts to /api/incidents with title and team_id", async () => {
    server.use(
      http.post("https://ir.example.com/api/incidents", async ({ request }) => {
        expect(await request.json()).toEqual({ title: "Checkout latency spike", team_id: 1, priority: "p1" });
        return HttpResponse.json({ id: 340 });
      })
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_create_incident")!;
    const r = await executeOperation(ctx(), tool.map({ title: "Checkout latency spike", team_id: 1, priority: "p1" }));
    expect(r.isError).toBeFalsy();
  });

  it("ir_list_incidents uses the v2.3 synthesized operation id", async () => {
    server.use(
      http.get("https://ir.example.com/api/incidents", () => HttpResponse.json({ items: [] }))
    );
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_list_incidents")!;
    const r = await executeOperation(ctx(), tool.map({}));
    expect(r.isError).toBeFalsy();
  });

  it("ir_remove_silence requires confirm (destructive)", async () => {
    const tool = CURATED_TOOLS.find((t) => t.name === "ir_remove_silence")!;
    const blocked = await executeOperation(ctx(), tool.map({ silence_id: 3 }));
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toMatch(/confirm: true/);
  });
});
