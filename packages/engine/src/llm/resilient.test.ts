import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiProvider } from "./gemini.js";
import { BudgetExceededError, MeteredProvider, type LlmProvider } from "./provider.js";
import { ModelUnavailableError, ResilientProvider } from "./resilient.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const request = { name: "test", system: "private-system", user: "private-diff", schema: z.object({ answer: z.string() }) };
const output = { value: { answer: "private-model-output" }, inputTokens: 12, outputTokens: 3 };
function provider(error?: Error): LlmProvider {
  return { id: "stub", complete: vi.fn(async (r) => {
    if (error) throw error;
    return { ...output, value: r.schema.parse(output.value) };
  }) };
}
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "viva-cache-"));
  dirs.push(dir);
  return dir;
}
async function record(cacheDir: string) {
  return new ResilientProvider(provider(), { cacheDir, cacheIdentity: "model", record: true }).complete(request);
}

describe("opt-in model replay", () => {
  it("records validated output and replays identical output offline without calling either model", async () => {
    const cacheDir = await directory();
    expect(await record(cacheDir)).toEqual(output);
    const live = provider(new Error("Gemini returned 429: secret body"));
    const fallback = provider();
    const replay = new ResilientProvider(live, { cacheDir, cacheIdentity: "model", replayOnly: true, fallback });
    expect(await replay.complete(request)).toEqual(output);
    expect(live.complete).not.toHaveBeenCalled();
    expect(fallback.complete).not.toHaveBeenCalled();
    expect(replay.id).toBe("stub+replay");
    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(JSON.parse(await readFile(join(cacheDir, files[0]!), "utf8"))).toEqual(output);
  });

  it("rejects a schema mismatch in a cache file without exposing its contents", async () => {
    const cacheDir = await directory();
    await record(cacheDir);
    const file = join(cacheDir, (await readdir(cacheDir))[0]!);
    await writeFile(file, JSON.stringify({ ...output, value: { answer: 42 } }));
    const replay = new ResilientProvider(provider(), { cacheDir, cacheIdentity: "model", replayOnly: true });
    await expect(replay.complete(request)).rejects.toMatchObject({ reason: "replay-miss" });
  });

  it.each([
    { ...request, user: "different" },
    { ...request, system: "different" },
    { ...request, name: "different" },
    { ...request, schema: z.object({ answer: z.string().min(100) }) },
  ])("misses when any request or schema content changes", async (changed) => {
    const cacheDir = await directory();
    await record(cacheDir);
    const replay = new ResilientProvider(provider(), { cacheDir, cacheIdentity: "model", replayOnly: true });
    await expect(replay.complete(changed)).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("does not reuse another model's cache", async () => {
    const cacheDir = await directory();
    await record(cacheDir);
    await expect(new ResilientProvider(provider(), { cacheDir, cacheIdentity: "other", replayOnly: true })
      .complete(request)).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("never writes without record opt-in, even on a cache miss", async () => {
    const cacheDir = await directory();
    await new ResilientProvider(provider(), { cacheIdentity: "model", cacheDir }).complete(request);
    expect(await readdir(cacheDir)).toEqual([]);
    // Even record=true cannot write unless a directory was explicitly supplied.
    await new ResilientProvider(provider(), { cacheIdentity: "model", record: true }).complete(request);
  });

  it("retains token accounting and the MeteredProvider budget on replay", async () => {
    const cacheDir = await directory();
    await record(cacheDir);
    const metered = new MeteredProvider(new ResilientProvider(provider(), {
      cacheDir, cacheIdentity: "model", replayOnly: true,
    }), 12);
    await metered.complete(request);
    expect(metered.usage).toEqual({ inputTokens: 12, outputTokens: 3, llmCalls: 1 });
    await expect(metered.complete(request)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

const networkErrors = [
  new TypeError("fetch failed"),
  ...["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]
    .map((code) => new Error("private network failure", { cause: { code } })),
  new DOMException("expired", "AbortError"),
  new DOMException("expired", "TimeoutError"),
  new Error("request timed out"),
];

describe("capacity degradation", () => {
  it.each(networkErrors)("tries fallback then labels network exhaustion: %s", async (error) => {
    const fallback = provider();
    const resilient = new ResilientProvider(provider(error), { cacheIdentity: "model", fallback });
    expect(await resilient.complete(request)).toEqual(output);
    expect(fallback.complete).toHaveBeenCalledTimes(1);
    expect(resilient.id).toBe("stub+fallback");
    await expect(new ResilientProvider(provider(error), {
      cacheIdentity: "model", fallback: provider(error),
    }).complete(request)).rejects.toMatchObject({ name: "ModelUnavailableError", reason: "capacity-or-timeout" });
  });

  it("tries newly available replay before fallback after a network failure", async () => {
    const cacheDir = await directory();
    const live: LlmProvider = { id: "stub", complete: vi.fn(async () => {
      await record(cacheDir);
      throw new TypeError("fetch failed");
    }) };
    const fallback = provider();
    const resilient = new ResilientProvider(live, { cacheDir, cacheIdentity: "model", fallback });
    expect(await resilient.complete(request)).toEqual(output);
    expect(fallback.complete).not.toHaveBeenCalled();
    expect(resilient.id).toBe("stub+replay");
  });

  it("preserves bounded Gemini retries before switching models on fetch failures", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(output.value) }] } }] })));
    vi.stubGlobal("fetch", fetch);
    const resilient = new ResilientProvider(new GeminiProvider("fake", "primary", undefined, 0), {
      cacheIdentity: "primary", fallback: new GeminiProvider("fake", "fallback", undefined, 0),
    });
    expect((await resilient.complete(request)).value).toEqual(output.value);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("models/primary:"), expect.stringContaining("models/primary:"), expect.stringContaining("models/fallback:"),
    ]);
  });

  it("tries replay after a 429 before fallback (including a concurrently recorded result)", async () => {
    const cacheDir = await directory();
    const live: LlmProvider = { id: "stub", complete: vi.fn(async () => {
      await record(cacheDir);
      throw new Error("Gemini returned 429");
    }) };
    const fallback = provider();
    const resilient = new ResilientProvider(live, { cacheDir, cacheIdentity: "model", fallback });
    expect(await resilient.complete(request)).toEqual(output);
    expect(fallback.complete).not.toHaveBeenCalled();
    expect(resilient.id).toBe("stub+replay");
  });

  it.each([new Error("Gemini returned 429"), new Error("RESOURCE_EXHAUSTED"), new Error("Gemini returned 503"), new DOMException("expired", "TimeoutError")])(
    "falls back on %s and labels the provider", async (error) => {
      const fallback = provider();
      const resilient = new ResilientProvider(provider(error), { cacheIdentity: "model", fallback });
      expect(await resilient.complete(request)).toEqual(output);
      expect(fallback.complete).toHaveBeenCalledTimes(1);
      expect(resilient.id).toBe("stub+fallback");
    },
  );

  it("returns a safe labelled failure when replay and fallback are unavailable", async () => {
    const resilient = new ResilientProvider(provider(new Error("429 private-diff")), {
      cacheIdentity: "model", fallback: provider(new Error("RESOURCE_EXHAUSTED private-output")),
    });
    await expect(resilient.complete(request)).rejects.toMatchObject({ reason: "capacity-or-timeout" });
    expect(resilient.id).toBe("stub+unavailable");
  });

  it("does not mask non-capacity or schema errors with fallback", async () => {
    const fallback = provider();
    await expect(new ResilientProvider(provider(new TypeError("cannot read property")), { cacheIdentity: "model", fallback })
      .complete(request)).rejects.toThrow("cannot read property");
    await expect(new ResilientProvider(provider(new Error("invalid JSON")), { cacheIdentity: "model", fallback })
      .complete(request)).rejects.toThrow("invalid JSON");
    expect(fallback.complete).not.toHaveBeenCalled();
    // Validation errors can contain output text that resembles a quota error.
    const invalid: LlmProvider = { id: "invalid", complete: async () => {
      z.object({ quota: z.string() }).parse({ quota: 429 });
      throw new Error("unreachable");
    } };
    await expect(new ResilientProvider(invalid, { cacheIdentity: "model", fallback })
      .complete(request)).rejects.toMatchObject({ name: "ZodError" });
    expect(fallback.complete).not.toHaveBeenCalled();
  });

  it("bounds Gemini 429 retries and backs off, without adding wrapper retries", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("RESOURCE_EXHAUSTED", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const resilient = new ResilientProvider(new GeminiProvider("fake", "primary", undefined, 800), { cacheIdentity: "primary" });
    const result = resilient.complete(request).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(799);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(ModelUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never sends cache contents or provider error bodies to console", async () => {
    const spies = ["log", "warn", "error", "info", "debug"].map((method) =>
      vi.spyOn(console, method as "log").mockImplementation(() => {}));
    const cacheDir = await directory();
    await record(cacheDir);
    await new ResilientProvider(provider(), { cacheDir, cacheIdentity: "model", replayOnly: true }).complete(request);
    await new ResilientProvider(provider(new Error("429 private-error-body")), { cacheIdentity: "model" })
      .complete(request).catch(() => {});
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
