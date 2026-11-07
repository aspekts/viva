import { FogMap, Review, ReviewCode, VivaEvent, type Answer, type CodeLocation } from "@viva/contracts";
import mockCode from "../../../../fixtures/mock/code.json";
import mockFog from "../../../../fixtures/mock/fog.json";
import mockEmptyFog from "../../../../fixtures/mock/fog-empty.json";
import mockReview from "../../../../fixtures/mock/review.json";

/** Mock mode lets the UI run with no daemon: add ?mock to the URL, and &empty for the empty states. */
const params = new URLSearchParams(location.search);
const MOCK = params.has("mock");
const MOCK_EMPTY = MOCK && params.has("empty");

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

const POLL_MS = 2000;

/**
 * Calls refresh whenever the fog or a review changes, and returns a function to
 * stop. It listens to live events, and polls for as long as they're unavailable.
 */
export function watch(topic: VivaEvent["type"], refresh: () => void): () => void {
  if (MOCK) return () => {};
  let poll: ReturnType<typeof setInterval> | undefined;
  const startPolling = () => { poll ??= setInterval(refresh, POLL_MS); };
  const stopPolling = () => { clearInterval(poll); poll = undefined; };

  startPolling();
  if (typeof EventSource === "undefined") return stopPolling;
  const events = new EventSource("/v1/events");
  events.onopen = () => {
    stopPolling();
    // Nothing is replayed, so catch up on whatever changed while disconnected.
    refresh();
  };
  events.onerror = startPolling;
  events.onmessage = ({ data }) => {
    if (VivaEvent.parse(JSON.parse(data)).type === topic) refresh();
  };
  return () => {
    events.close();
    stopPolling();
  };
}

/** Maps the most recently pushed repo. `repoPath` is null until the daemon has seen a push. */
export async function getFog(): Promise<FogMap> {
  if (MOCK) return FogMap.parse(MOCK_EMPTY ? mockEmptyFog : mockFog);
  return FogMap.parse(await json("/v1/fog"));
}

export async function getReview(id: string): Promise<Review> {
  if (MOCK) return Review.parse(mockReview);
  return Review.parse(await json(`/v1/reviews/${encodeURIComponent(id)}`));
}

/** The most recently pushed review, or null if the daemon has none. Never sample data outside ?mock. */
export async function getLatestReview(): Promise<Review | null> {
  if (MOCK) return MOCK_EMPTY ? null : Review.parse(mockReview);
  return Review.array().parse(await json("/v1/reviews"))[0] ?? null;
}

/**
 * Loads one review for the exam: the given ID, or else the newest, which it then
 * stays on so a later push can't swap the questions mid-exam. Answers that arrive
 * out of order, or for another review once one is open, are ignored.
 */
export function reviewLoader(
  reviewId: string | null,
  onLoad: (review: Review | null) => void,
  onError: (error: Error) => void,
) {
  let id = reviewId;
  let latest = 0;
  let stopped = false;
  const load = () => {
    const call = ++latest;
    (id ? getReview(id) : getLatestReview()).then(
      (loaded) => {
        if (stopped || call !== latest || (id && loaded?.id !== id)) return;
        if (loaded) id = loaded.id;
        onLoad(loaded);
      },
      (error: Error) => { if (!stopped && call === latest) onError(error); },
    );
  };
  return { load, stop: () => { stopped = true; } };
}

/** Mock mode has one snippet, so it returns that for any location. */
export async function getReviewCode(id: string, { file, lines: [start, end] }: CodeLocation): Promise<ReviewCode> {
  if (MOCK) return ReviewCode.parse(mockCode);
  const query = new URLSearchParams({ file, start: String(start), end: String(end) });
  return ReviewCode.parse(await json(`/v1/reviews/${encodeURIComponent(id)}/code?${query}`));
}

export async function submitAnswers(id: string, answers: Answer[]): Promise<Review> {
  if (MOCK) return Review.parse({ ...mockReview, stage: "done", gate: { verdict: "approve", reason: "exam-passed", skippable: true } });
  return Review.parse(
    await json(`/v1/reviews/${id}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(answers),
    }),
  );
}
