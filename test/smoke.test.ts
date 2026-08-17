import { describe, it, expect } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "../src/version.js";

describe("scaffolding", () => {
  it("exposes server identity", () => {
    expect(SERVER_NAME).toBe("incidentrelay-mcp");
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
