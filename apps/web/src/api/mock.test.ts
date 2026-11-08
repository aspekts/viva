import { describe, expect, it } from "vitest";
import { mockSubmit } from "./mock";

describe("mockSubmit", () => {
  it("fails a blank answer with the rubric points as missing", () => {
    const review = mockSubmit([{ questionId: "q1", transcript: "   ", mode: "typed" }]);

    expect(review.gate).toEqual({ verdict: "reject", reason: "exam-failed", skippable: true });
    expect(review.grades[0]).toMatchObject({ questionId: "q1", verdict: "reject", score: 0 });
    expect(review.grades[0]?.missing.length).toBeGreaterThan(0);
  });

  it("fails when the answer for a question is missing altogether", () => {
    expect(mockSubmit([]).gate?.verdict).toBe("reject");
  });

  it("passes an answered question", () => {
    const review = mockSubmit([{ questionId: "q1", transcript: "It charges twice", mode: "typed" }]);

    expect(review.stage).toBe("done");
    expect(review.gate).toEqual({ verdict: "approve", reason: "exam-passed", skippable: true });
    expect(review.grades[0]?.missing).toEqual([]);
  });
});
