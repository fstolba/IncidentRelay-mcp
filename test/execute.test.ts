import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { buildCatalog } from "../src/openapi/catalog.js";
import { IRClient } from "../src/client.js";
import { executeOperation, type ToolCtx } from "../src/execute.js";

const SPEC = {
  paths: {
    "/api/alerts/{alert_id}/ack": {
      post: { operationId: "acknowledgeAlertGroup", tags: ["alerts"], summary: "Ack", parameters: [{ name: "alert_id", in: "path", required: true, schema: { type: "integer" } }] },
    },
    "/api/routes/{route_id}": { delete: { operationId: "deleteRoute", tags: ["routes"], summary: "Delete route", parameters: [{ name: "route_id", in: "path", required: true, schema: { type: "integer" } }] } },
  },
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ctx(readonly = false): ToolCtx {
  const cfg = { baseUrl: "https://ir.example.com", token: "t", transport: "stdio" as const, port: 3000, host: "127.0.0.1", readonly, timeoutMs: 5000, openapiUrl: "x", verifyTls: true };
  return { catalog: buildCatalog(SPEC), client: new IRClient(cfg), readonly };
}

describe("executeOperation", () => {
  it("executes a known operation by id", async () => {
    server.use(http.post("https://ir.example.com/api/alerts/9/ack", () => HttpResponse.json({ ok: true })));
    const r = await executeOperation(ctx(), { operationId: "acknowledgeAlertGroup", pathParams: { alert_id: 9 } });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("ok");
  });

  it("blocks destructive op without confirm", async () => {
    const r = await executeOperation(ctx(), { operationId: "deleteRoute", pathParams: { route_id: 5 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/confirm: true/);
  });

  it("executes destructive op with confirm", async () => {
    server.use(http.delete("https://ir.example.com/api/routes/5", () => HttpResponse.json({ deleted: true })));
    const r = await executeOperation(ctx(), { operationId: "deleteRoute", pathParams: { route_id: 5 }, confirm: true });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("deleted");
  });

  it("blocks writes in readonly mode", async () => {
    const r = await executeOperation(ctx(true), { operationId: "acknowledgeAlertGroup", pathParams: { alert_id: 9 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/read-only/i);
  });

  it("errors on unknown operationId", async () => {
    const r = await executeOperation(ctx(), { operationId: "nope" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/unknown operation/i);
  });

  it("supports raw method+path", async () => {
    server.use(http.get("https://ir.example.com/api/ping", () => HttpResponse.json({ pong: 1 })));
    const r = await executeOperation(ctx(), { method: "GET", path: "/api/ping" });
    expect(r.content[0].text).toContain("pong");
  });
});
