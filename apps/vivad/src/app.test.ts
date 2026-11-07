import { describe, expect, it } from "vitest";
import { MockProvider } from "@viva/engine";
import { createApp } from "./app.js";

describe("vivad", () => {
  it("reports health", async () => {
    const response = await createApp(new MockProvider()).request("/v1/health");
    expect(await response.json()).toEqual({ ok: true, llm: "mock" });
  });

  it("returns 404 for unknown reviews", async () => {
    const response = await createApp(new MockProvider()).request("/v1/reviews/nope");
    expect(response.status).toBe(404);
  });
});
