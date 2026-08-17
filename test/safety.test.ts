import { describe, it, expect } from "vitest";
import { classify, guard } from "../src/safety.js";

describe("classify", () => {
  it("GET is read", () => {
    expect(classify({ method: "GET", path: "/api/alerts" })).toBe("read");
  });
  it("DELETE is destructive", () => {
    expect(classify({ method: "DELETE", path: "/api/routes/1" })).toBe("destructive");
  });
  it("destructive verbs in path are destructive", () => {
    expect(classify({ method: "POST", path: "/api/routes/1/intake-token" })).toBe("destructive");
    expect(classify({ method: "POST", path: "/api/silences/1/enable" })).toBe("write");
    expect(classify({ method: "POST", path: "/api/alerts/merge" })).toBe("destructive");
  });
  it("other POST/PUT are write", () => {
    expect(classify({ method: "POST", path: "/api/alerts/1/ack" })).toBe("write");
  });
});

describe("guard", () => {
  it("blocks writes in readonly mode", () => {
    const r = guard({ method: "POST", path: "/api/alerts/1/ack" }, { confirm: false, readonly: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/read-only/i);
  });
  it("requires confirm for destructive ops and returns a preview", () => {
    const r = guard({ method: "DELETE", path: "/api/routes/5" }, { confirm: false, readonly: false });
    expect(r.allowed).toBe(false);
    expect(r.preview).toMatch(/confirm/i);
    expect(r.preview).toContain("DELETE /api/routes/5");
  });
  it("allows destructive ops when confirmed", () => {
    expect(guard({ method: "DELETE", path: "/api/routes/5" }, { confirm: true, readonly: false }).allowed).toBe(true);
  });
  it("allows plain writes without confirm", () => {
    expect(guard({ method: "POST", path: "/api/alerts/1/ack" }, { confirm: false, readonly: false }).allowed).toBe(true);
  });
});
