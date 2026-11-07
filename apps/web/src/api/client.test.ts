import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.last = this; }
  close() { this.closed = true; }
}

async function client(search: string) {
  vi.stubGlobal("location", { search });
  vi.resetModules();
  return import("./client");
}

describe("watch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.last = null;
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls until events connect, then only refreshes on matching events", async () => {
    const { watch } = await client("");
    const refresh = vi.fn();
    const stop = watch("fog", refresh);
    expect(FakeEventSource.last?.url).toBe("/v1/events");
    vi.advanceTimersByTime(4000);
    expect(refresh).toHaveBeenCalledTimes(2);

    FakeEventSource.last!.onopen!();
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(10000);
    expect(refresh).toHaveBeenCalledTimes(3);

    FakeEventSource.last!.onmessage!({ data: JSON.stringify({ type: "review", reviewId: "r", stage: "done", gate: null }) });
    expect(refresh).toHaveBeenCalledTimes(3);
    FakeEventSource.last!.onmessage!({ data: JSON.stringify({ type: "fog", repoPath: "/repo" }) });
    expect(refresh).toHaveBeenCalledTimes(4);
    stop();
    expect(FakeEventSource.last!.closed).toBe(true);
  });

  it("falls back to polling when events drop, without doubling up", async () => {
    const { watch } = await client("");
    const refresh = vi.fn();
    const stop = watch("review", refresh);
    FakeEventSource.last!.onopen!();
    refresh.mockClear();
    FakeEventSource.last!.onerror!();
    FakeEventSource.last!.onerror!();
    vi.advanceTimersByTime(4000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(4000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("polls when the browser has no EventSource", async () => {
    vi.stubGlobal("EventSource", undefined);
    const { watch } = await client("");
    const refresh = vi.fn();
    const stop = watch("fog", refresh);
    vi.advanceTimersByTime(2000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does nothing in mock mode, so no daemon is needed", async () => {
    const { watch } = await client("?mock");
    const refresh = vi.fn();
    watch("fog", refresh)();
    vi.advanceTimersByTime(10000);
    expect(FakeEventSource.last).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("reviews", () => {
  afterEach(() => vi.unstubAllGlobals());

  const daemon = (body: unknown) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };
  const sample = async () => JSON.parse(JSON.stringify((await import("../../../../fixtures/mock/review.json")).default));

  it("opens the newest live review, never sample data", async () => {
    const live = { ...(await sample()), id: "live-review" };
    const fetch = daemon([live, { ...live, id: "older" }]);
    const { getLatestReview } = await client("");
    expect((await getLatestReview())?.id).toBe("live-review");
    expect(fetch).toHaveBeenCalledWith("/v1/reviews", undefined);
  });

  it("returns null, not the mock review, when the daemon has no reviews", async () => {
    daemon([]);
    const { getLatestReview } = await client("");
    expect(await getLatestReview()).toBeNull();
  });

  it("fetches a review by ID from the daemon outside mock mode", async () => {
    const fetch = daemon({ ...(await sample()), id: "a/b" });
    const { getReview } = await client("");
    expect((await getReview("a/b")).id).toBe("a/b");
    expect(fetch).toHaveBeenCalledWith("/v1/reviews/a%2Fb", undefined);
  });

  it("uses sample data only in mock mode, with &empty for the empty state", async () => {
    const fetch = daemon([]);
    expect((await (await client("?mock")).getLatestReview())?.id).toBe("mock-review");
    expect(await (await client("?mock&empty")).getLatestReview()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("skipReview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the skip and returns the new review", async () => {
    const sample = JSON.parse(JSON.stringify((await import("../../../../fixtures/mock/review.json")).default));
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...sample, stage: "done", gate: { verdict: "approve", reason: "skipped-with-debt", skippable: true } })));
    vi.stubGlobal("fetch", fetch);
    const { skipReview } = await client("");
    expect((await skipReview("r1")).gate?.reason).toBe("skipped-with-debt");
    expect(fetch).toHaveBeenCalledWith("/v1/reviews/r1/skip", { method: "POST" });
  });

  it("surfaces the daemon's refusal of a hard gate as a 409", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "this gate cannot be skipped" }), { status: 409 })));
    const { ApiError, skipReview } = await client("");
    const refusal = await skipReview("r1").catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal).toMatchObject({ status: 409 });
  });

  it("skips the mock exam, and refuses the mock hard gate", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await (await client("?mock")).skipReview("mock-review")).gate?.reason).toBe("skipped-with-debt");
    const hard = await client("?mock&hard");
    expect((await hard.getLatestReview())?.gate).toMatchObject({ reason: "injection-suspected", skippable: false });
    await expect(hard.skipReview("mock-hard-gate")).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("saveMemory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the opt-in save and returns what was written", async () => {
    const saved = (await import("../../../../fixtures/mock/memory.json")).default;
    const fetch = vi.fn(async () => new Response(JSON.stringify(saved)));
    vi.stubGlobal("fetch", fetch);
    const { saveMemory } = await client("");
    expect((await saveMemory("a/b")).files).toEqual([".viva/memory/src/webhook.ts.md"]);
    expect(fetch).toHaveBeenCalledWith("/v1/reviews/a%2Fb/memory", { method: "POST" });
  });

  it("returns sample memory in mock mode without a daemon", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await (await client("?mock")).saveMemory("mock-review")).entries[0]?.claim).toMatch(/idempotency/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
