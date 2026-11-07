import { Review, type Answer, type Grade } from "@viva/contracts";
import mockReview from "../../../../fixtures/mock/review.json";

/** Mock grading mirrors the daemon: a blank answer scores zero, and the worst grade wins. */
export function mockSubmit(answers: Answer[]): Review {
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
