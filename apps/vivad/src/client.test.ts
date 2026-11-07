import { afterEach, expect, it, vi } from "vitest";
import { DaemonClient, SubmissionTimeoutError } from "./client.js";
import sample from "../../../fixtures/mock/review.json";
import feedback from "../../../fixtures/mock/feedback.json";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("bounds creation/reads at 15s and gives answers/skip 120s", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/feedback") ? feedback : sample))));
  const client = new DaemonClient();
  await client.start(sample.request);
  await client.review("r");
  await client.feedback("r");
  await client.answer("r", []);
  await client.skip("r");
  expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([15_000, 15_000, 15_000, 120_000, 120_000]);
});

it.each(["answer", "skip"] as const)("allows slow %s but classifies a submission deadline distinctly", async (method) => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), ms);
    return controller.signal;
  });
  let delay = 20_000;
  vi.stubGlobal("fetch", vi.fn((_url, { signal }: RequestInit) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(JSON.stringify(sample))), delay);
    signal!.addEventListener("abort", () => { clearTimeout(timer); reject(signal!.reason); }, { once: true });
  })));
  const client = new DaemonClient();
  const submit = () => method === "answer" ? client.answer("r", []) : client.skip("r");
  const slow = submit();
  await vi.advanceTimersByTimeAsync(20_000);
  await expect(slow).resolves.toHaveProperty("id", sample.id);
  delay = 130_000;
  const timedOut = expect(submit()).rejects.toBeInstanceOf(SubmissionTimeoutError);
  await vi.advanceTimersByTimeAsync(120_000);
  await timedOut;
});

it("keeps a dead daemon as an infrastructure failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  await expect(new DaemonClient().answer("r", [])).rejects.toBeInstanceOf(TypeError);
});

it("recognizes a deadline during response-body reading even when fetch reports AbortError", async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => {
      controller.abort(new DOMException("deadline", "TimeoutError"));
      throw new DOMException("body aborted", "AbortError");
    },
  })));
  await expect(new DaemonClient().answer("r", [])).rejects.toBeInstanceOf(SubmissionTimeoutError);
});
