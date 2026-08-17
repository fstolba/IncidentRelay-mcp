import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { IRClient, IRError, buildUrl } from "../src/client.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const cfg = {
  baseUrl: "https://ir.example.com",
  token: "tok123",
  transport: "stdio" as const,
  port: 3000,
  host: "127.0.0.1",
  readonly: false,
  timeoutMs: 5000,
  openapiUrl: "https://ir.example.com/api/openapi.json",
  verifyTls: true,
};

describe("buildUrl", () => {
  it("substitutes path params and appends query incl. arrays", () => {
    const url = buildUrl("https://ir.example.com", "/api/alerts/{alert_id}/ack", { alert_id: 7 }, {
      status: ["firing", "acknowledged"],
      q: "disk",
    });
    expect(url).toBe(
      "https://ir.example.com/api/alerts/7/ack?status=firing&status=acknowledged&q=disk"
    );
  });
});

describe("IRClient", () => {
  it("sends bearer auth and returns parsed data", async () => {
    server.use(
      http.get("https://ir.example.com/api/alerts", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer tok123");
        return HttpResponse.json({ items: [{ id: 1 }] });
      })
    );
    const client = new IRClient(cfg);
    const res = await client.call({ method: "GET", path: "/api/alerts" });
    expect(res.ok).toBe(true);
    expect((res.data as any).items[0].id).toBe(1);
  });

  it("normalizes a 403 scope error with suggestion", async () => {
    server.use(
      http.post("https://ir.example.com/api/alerts/1/ack", () =>
        HttpResponse.json({ error: "Missing API token scope", missing_scopes: ["alerts:write"] }, { status: 403 })
      )
    );
    const client = new IRClient(cfg);
    await expect(
      client.call({ method: "POST", path: "/api/alerts/{alert_id}/ack", pathParams: { alert_id: 1 } })
    ).rejects.toMatchObject({ status: 403, missing_scopes: ["alerts:write"] });
  });

  it("captures routing_error and error_id", async () => {
    server.use(
      http.post("https://ir.example.com/api/integrations/webhook", () =>
        HttpResponse.json({ routing_error: "no matching route", error_id: "abc-123" }, { status: 422 })
      )
    );
    const client = new IRClient(cfg);
    try {
      await client.call({ method: "POST", path: "/api/integrations/webhook", body: {} });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as IRError;
      expect(err.routing_error).toBe("no matching route");
      expect(err.error_id).toBe("abc-123");
      expect(err.suggestion.length).toBeGreaterThan(0);
    }
  });
});
