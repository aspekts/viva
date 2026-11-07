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
