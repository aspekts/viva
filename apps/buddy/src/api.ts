import { Review, type Answer, type Grade } from "@viva/contracts";
import { ApiError } from "../../web/src/api/errors";
import mockFailed from "../../../fixtures/mock/review-failed.json";
import mockHardGate from "../../../fixtures/mock/review-hard-gate.json";
import mockSample from "../../../fixtures/mock/review.json";

export { ApiError };

/** ?mock runs with no daemon. Add &hard for a hard gate or &failed for a failed exam. */
const params = new URLSearchParams(location.search);
export const isMockMode = params.has("mock");
const mockReview = params.has("hard") ? mockHardGate : params.has("failed") ? mockFailed : mockSample;

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  if (!response.ok) throw new ApiError(response.status, `${path} returned ${response.status}`);
  return response.json();
}

/** The given review, or the newest one when the page was opened without an ID. */
export async function loadReview(id: string | null): Promise<Review | null> {
  if (isMockMode) return Review.parse(mockReview);
  if (id) return Review.parse(await json(`/v1/reviews/${encodeURIComponent(id)}`));
  return Review.array().parse(await json("/v1/reviews"))[0] ?? null;
}

/** Mock grading mirrors the daemon: a blank answer scores zero, and the worst grade wins. */
function mockSubmit(answers: Answer[]): Review {
  const review = Review.parse(mockSample);
  const grades: Grade[] = (review.plan?.questions ?? []).map((q) => {
    const blank = (answers.find((a) => a.questionId === q.id)?.transcript ?? "").trim() === "";
    return blank
      ? { questionId: q.id, verdict: "reject", score: 0, missing: q.mustMention }
      : { questionId: q.id, verdict: "approve", score: 1, missing: [] };
  });
  const failed = grades.some((g) => g.verdict === "reject");
  return Review.parse({
    ...review,
    stage: "done",
    grades,
    gate: failed ? { verdict: "reject", reason: "exam-failed", skippable: true } : { verdict: "approve", reason: "exam-passed", skippable: true },
  });
}

export async function submitAnswers(id: string, answers: Answer[]): Promise<Review> {
  if (isMockMode) return mockSubmit(answers);
  return Review.parse(await json(`/v1/reviews/${encodeURIComponent(id)}/answers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(answers),
  }));
}

/** The daemon refuses with a 409 for hard gates and pushes that are already allowed. */
export async function skipReview(id: string): Promise<Review> {
  if (isMockMode) {
    const { gate } = Review.parse(mockReview);
    if (gate && (!gate.skippable || gate.verdict === "approve" || gate.verdict === "endorse")) {
      throw new ApiError(409, "this gate cannot be skipped");
    }
    return Review.parse({ ...mockReview, stage: "done", gate: { verdict: "approve", reason: "skipped-with-debt", skippable: true }, finishedAt: new Date().toISOString() });
  }
  return Review.parse(await json(`/v1/reviews/${encodeURIComponent(id)}/skip`, { method: "POST" }));
}

/** The full exam room, for code highlighting. Same review, other site. */
export const EXAM_ROOM = (import.meta.env.VITE_VIVA_WEB as string | undefined) ?? "http://localhost:5173";
export const examRoomLink = (id: string) => `${EXAM_ROOM}/?review=${encodeURIComponent(id)}${isMockMode ? "&mock" : ""}`;
