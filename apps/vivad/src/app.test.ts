import { describe, expect, it, vi } from "vitest";
import { fixtureRepo, MockProvider, type LlmProvider } from "@viva/engine";
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

  it("keeps error text out of the log and the response", async () => {
    const canary = "CANARY-quoted-from-the-transcript";
    const failing: LlmProvider = {
      id: "failing",
      complete: async () => {
        throw new Error(`could not parse model output: ${canary}`);
      },
    };
    const { repo, base, head } = fixtureRepo({ "a.ts": "export const a = 1;\n" }, { "a.ts": "export const a = 2;\n" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await createApp(failing).request("/v1/reviews", {
      method: "POST",
      body: JSON.stringify({ repoPath: repo, base, head, person: "p" }),
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(canary);
    expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
    log.mockRestore();
  });
});
