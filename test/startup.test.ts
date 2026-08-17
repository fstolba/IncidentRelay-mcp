import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { buildSnapshotContext, refreshCatalogFromLive } from "../src/server.js";
import type { Config } from "../src/config.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const cfg: Config = {
  baseUrl: "https://ir.example.com",
  token: "t",
  transport: "stdio",
  port: 3000,
  host: "127.0.0.1",
  readonly: false,
  timeoutMs: 30000,
  openapiUrl: "https://ir.example.com/api/openapi.json",
  verifyTls: true,
};

describe("startup", () => {
  it("builds a context from the bundled snapshot synchronously (no network)", () => {
    const ctx = buildSnapshotContext(cfg);
    expect(ctx.catalog.size).toBeGreaterThan(250);
    expect(ctx.catalog.get("listAlertGroups")).toBeDefined();
    expect(ctx.readonly).toBe(false);
  });

  it("swaps the catalog when the live spec is reachable", async () => {
    server.use(
      http.get("https://ir.example.com/api/openapi.json", () =>
        HttpResponse.json({
          paths: { "/api/unique-live": { get: { operationId: "uniqueLiveOp", tags: ["x"], summary: "u" } } },
        })
      )
    );
    const ctx = buildSnapshotContext(cfg);
    expect(ctx.catalog.get("uniqueLiveOp")).toBeUndefined();
    const source = await refreshCatalogFromLive(ctx, cfg);
    expect(source).toBe("live");
    expect(ctx.catalog.get("uniqueLiveOp")).toBeDefined();
  });

  it("keeps the snapshot catalog when the live spec fails", async () => {
    server.use(
      http.get("https://ir.example.com/api/openapi.json", () => HttpResponse.json({}, { status: 500 }))
    );
    const ctx = buildSnapshotContext(cfg);
    const source = await refreshCatalogFromLive(ctx, cfg);
    expect(source).toBe("snapshot");
    expect(ctx.catalog.get("listAlertGroups")).toBeDefined();
  });
});
