import { describe, it, expect } from "vitest";
import { buildCatalog } from "../src/openapi/catalog.js";

const SPEC = {
  openapi: "3.0.3",
  components: {
    schemas: {
      Ack: { type: "object", properties: { note: { type: "string" } } },
    },
  },
  paths: {
    "/api/alerts": {
      get: {
        operationId: "listAlertGroups",
        tags: ["alerts"],
        summary: "List alert groups",
        parameters: [
          { name: "status", in: "query", required: false, schema: { type: "string" } },
        ],
      },
    },
    "/api/alerts/{alert_id}/ack": {
      post: {
        operationId: "acknowledgeAlertGroup",
        tags: ["alerts"],
        summary: "Acknowledge an alert group",
        parameters: [{ name: "alert_id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/Ack" } } },
        },
      },
    },
    "/api/heartbeats": {
      post: { tags: ["Heartbeats"], summary: "Create heartbeat" },
    },
  },
};

describe("catalog", () => {
  const cat = buildCatalog(SPEC);

  it("indexes operations by id", () => {
    expect(cat.get("listAlertGroups")?.method).toBe("GET");
    expect(cat.get("acknowledgeAlertGroup")?.path).toBe("/api/alerts/{alert_id}/ack");
  });

  it("synthesizes ids for operations without operationId", () => {
    const op = cat.findByMethodPath("POST", "/api/heartbeats");
    expect(op).toBeDefined();
    expect(cat.get(op!.operationId)).toBeDefined();
  });

  it("resolves $ref in request body", () => {
    const op = cat.get("acknowledgeAlertGroup")!;
    expect((op.requestBodySchema as any).properties.note.type).toBe("string");
  });

  it("filters list by query and tag", () => {
    expect(cat.list({ query: "acknowledge" }).map((o) => o.operationId)).toContain(
      "acknowledgeAlertGroup"
    );
    expect(cat.list({ method: "GET" }).every((o) => o.method === "GET")).toBe(true);
    expect(cat.list({ tag: "alerts" }).length).toBe(2);
  });

  it("describe returns params and body", () => {
    const d = cat.describe("acknowledgeAlertGroup") as any;
    expect(d.pathParams[0].name).toBe("alert_id");
    expect(d.requestBodySchema).toBeDefined();
  });
});

import { loadSnapshotSpec, buildCatalog as build2 } from "../src/openapi/catalog.js";

describe("bundled snapshot", () => {
  it("parses and contains the known on-call operations", () => {
    const cat = build2(loadSnapshotSpec());
    expect(cat.size).toBeGreaterThan(250);
    for (const id of ["listAlertGroups", "acknowledgeAlertGroup", "resolveAlertGroup", "listIncidents", "createSilence"]) {
      expect(cat.get(id), id).toBeDefined();
    }
  });
});
