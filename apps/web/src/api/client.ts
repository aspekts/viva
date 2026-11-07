import { FogMap, Review, ReviewCode, type Answer, type CodeLocation } from "@viva/contracts";
import mockCode from "../../../../fixtures/mock/code.json";
import mockFog from "../../../../fixtures/mock/fog.json";
import mockReview from "../../../../fixtures/mock/review.json";

/** Mock mode lets the UI run with no daemon: add ?mock to the URL. */
const MOCK = new URLSearchParams(location.search).has("mock");

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

export async function getFog(): Promise<FogMap> {
  return FogMap.parse(MOCK ? mockFog : await json("/v1/fog"));
}

export async function getReview(id: string | null): Promise<Review> {
  if (MOCK || !id) return Review.parse(mockReview);
  return Review.parse(await json(`/v1/reviews/${id}`));
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
