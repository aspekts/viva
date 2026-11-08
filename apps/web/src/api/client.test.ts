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

describe("mock roll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refreshes the fog on a timer and serves a changing map", async () => {
    const { watch, getFog } = await client("?mock&roll");
    const refresh = vi.fn();
    const stop = watch("fog", refresh);
    vi.advanceTimersByTime(8000);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    const first = await getFog();
    expect((await getFog()).nodes).toEqual(first.nodes);
    vi.advanceTimersByTime(4000);
    expect((await getFog()).nodes.map((n) => n.fog)).not.toEqual(first.nodes.map((n) => n.fog));
  });
});

describe("getFog", () => {
  afterEach(() => vi.unstubAllGlobals());

  const daemon = () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ repoPath: null, generatedAt: new Date().toISOString(), debt: 0, nodes: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  it("maps the most recently pushed repo by default", async () => {
    const fetch = daemon();
    const { getFog } = await client("");
    await getFog();
    expect(fetch).toHaveBeenCalledWith("/v1/fog", undefined);
  });

  it("maps the repo named in ?repo, so the Fog can show any repo without a push", async () => {
    const fetch = daemon();
    const { getFog } = await client("?repo=D%3A%2Frepos%2Fviva");
    await getFog();
    expect(fetch).toHaveBeenCalledWith("/v1/fog?repo=D%3A%2Frepos%2Fviva", undefined);
  });

  it("rejects with the status when the daemon cannot map that repo, so the page can say so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "internal error" }), { status: 500 })));
    const { getFog } = await client("?repo=D%3A%2Fgone");
    await expect(getFog()).rejects.toThrow("500");
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

describe("reviewLoader", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A daemon whose responses arrive only when the test releases them, in any order. */
  function slowDaemon() {
    const pending: ((body: unknown) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      pending.push((body) => resolve(new Response(JSON.stringify(body))));
    })));
    return pending;
  }
  const review = async (id: string) => ({ ...JSON.parse(JSON.stringify((await import("../../../../fixtures/mock/review.json")).default)), id });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("ignores an older answer that arrives after a newer one", async () => {
    const pending = slowDaemon();
    const { reviewLoader } = await client("");
    const shown: (string | null)[] = [];
    const loader = reviewLoader(null, (r) => shown.push(r?.id ?? null), () => {});
    loader.load();
    loader.load();
    pending[1]!([await review("newest-B")]);
    await settle();
    pending[0]!([await review("older-A")]);
    await settle();
    expect(shown).toEqual(["newest-B"]);
  });

  it("stays on the opened review when a newer one is pushed", async () => {
    const pending = slowDaemon();
    const { reviewLoader } = await client("");
    const shown: (string | null)[] = [];
    const loader = reviewLoader(null, (r) => shown.push(r?.id ?? null), () => {});
    loader.load();
    pending[0]!([await review("first")]);
    await settle();
    loader.load();
    expect(fetch).toHaveBeenLastCalledWith("/v1/reviews/first", undefined);
    pending[1]!(await review("first"));
    await settle();
    expect(shown).toEqual(["first", "first"]);
  });

  it("reports nothing after it stops", async () => {
    const pending = slowDaemon();
    const { reviewLoader } = await client("");
    const onLoad = vi.fn();
    const loader = reviewLoader(null, onLoad, () => {});
    loader.load();
    loader.stop();
    pending[0]!([await review("late")]);
    await settle();
    expect(onLoad).not.toHaveBeenCalled();
  });
});
