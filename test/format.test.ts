import { describe, it, expect } from "vitest";
import { shape, toToolText } from "../src/format.js";

describe("shape", () => {
  it("drops verbose keys when concise", () => {
    const out = shape({ id: 1, summary: "x", payload: { big: "data" }, raw: "..." }, "concise") as any;
    expect(out.id).toBe(1);
    expect(out.payload).toBeUndefined();
    expect(out.raw).toBeUndefined();
  });
  it("keeps everything when detailed", () => {
    const out = shape({ id: 1, payload: { big: "data" } }, "detailed") as any;
    expect(out.payload).toBeDefined();
  });
  it("recurses into arrays and nested objects", () => {
    const out = shape({ items: [{ id: 1, raw: "x" }] }, "concise") as any;
    expect(out.items[0].raw).toBeUndefined();
  });
});

describe("toToolText", () => {
  it("truncates oversized payloads with guidance", () => {
    const big = { items: Array.from({ length: 5000 }, (_, i) => ({ i, s: "x".repeat(50) })) };
    const text = toToolText(big, 1000);
    expect(text.length).toBeLessThan(1400);
    expect(text).toMatch(/truncated/i);
  });
});
