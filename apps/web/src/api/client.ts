import { FogMap, Review, type Answer } from "@viva/contracts";
import mockFog from "../../../../fixtures/mock/fog.json";
import mockReview from "../../../../fixtures/mock/review.json";
import { ApiError } from "./errors";
import { mockSubmit } from "./mock";

export { ApiError };

/** Mock mode lets the UI run with no daemon: add ?mock to the URL. */
const MOCK = new URLSearchParams(location.search).has("mock");

export const isMockMode = MOCK;

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  if (!response.ok) throw new ApiError(`${path} returned ${response.status}`, response.status);
  return response.json();
}

export async function getFog(): Promise<FogMap> {
  return FogMap.parse(MOCK ? mockFog : await json("/v1/fog"));
}

export async function getReview(id: string | null): Promise<Review> {
  if (MOCK) return Review.parse(mockReview);
  if (!id) throw new ApiError("no review id", 404);
  return Review.parse(await json(`/v1/reviews/${id}`));
}

export async function submitAnswers(id: string, answers: Answer[]): Promise<Review> {
  if (MOCK) return mockSubmit(answers);
  return Review.parse(
    await json(`/v1/reviews/${id}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(answers),
    }),
  );
}
