import { describe, it, expect } from "vitest";
import { loadConfig, redact } from "../src/config.js";

describe("loadConfig", () => {
  it("reads env and applies defaults", () => {
    const c = loadConfig([], { IR_BASE_URL: "https://ir.example.com", IR_TOKEN: "t" });
    expect(c.baseUrl).toBe("https://ir.example.com");
    expect(c.transport).toBe("stdio");
    expect(c.port).toBe(3000);
    expect(c.host).toBe("127.0.0.1");
    expect(c.readonly).toBe(false);
    expect(c.timeoutMs).toBe(30000);
    expect(c.verifyTls).toBe(true);
    expect(c.openapiUrl).toBe("https://ir.example.com/api/openapi.json");
  });

  it("lets flags override env", () => {
    const c = loadConfig(
      ["--transport", "http", "--port", "8080", "--readonly", "--base-url", "https://a.io"],
      { IR_BASE_URL: "https://b.io", IR_TRANSPORT: "stdio" }
    );
    expect(c.baseUrl).toBe("https://a.io");
    expect(c.transport).toBe("http");
    expect(c.port).toBe(8080);
    expect(c.readonly).toBe(true);
  });

  it("throws when base url is missing", () => {
    expect(() => loadConfig([], {})).toThrow(/IR_BASE_URL/);
  });
});

describe("redact", () => {
  it("hides the token", () => {
    expect(redact("auth Bearer secret123 done", "secret123")).not.toContain("secret123");
    expect(redact("Authorization: Bearer abc.def.ghi")).toContain("***");
  });
});
