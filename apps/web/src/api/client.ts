import { FogMap, Review, type Answer, type Grade } from "@viva/contracts";
import mockFog from "../../../../fixtures/mock/fog.json";
import mockReview from "../../../../fixtures/mock/review.json";

/** Mock mode lets the UI run with no daemon: add ?mock to the URL. */
const MOCK = new URLSearchParams(location.search).has("mock");

export const isMockMode = MOCK;

/** Handle failures by status code. The message text is not part of the contract. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

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

/** Mock grading mirrors the daemon: a blank answer scores zero, and the worst grade wins. */
function mockSubmit(answers: Answer[]): Review {
  const grades: Grade[] = mockReview.plan.questions.map((q) => {
    const blank = (answers.find((a) => a.questionId === q.id)?.transcript ?? "").trim() === "";
    return blank
      ? { questionId: q.id, verdict: "reject", score: 0, missing: q.mustMention }
      : { questionId: q.id, verdict: "approve", score: 1, missing: [] };
  });
  const failed = grades.some((g) => g.verdict === "reject");
  const gate = failed
    ? { verdict: "reject", reason: "exam-failed", skippable: true }
    : { verdict: "approve", reason: "exam-passed", skippable: true };
  return Review.parse({ ...mockReview, stage: "done", grades, gate });
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
