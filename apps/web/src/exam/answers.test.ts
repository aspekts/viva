import { describe, expect, it } from "vitest";
import type { Question } from "@viva/contracts";
import { buildAnswers, countUnanswered } from "./answers";
import { pushAllowed } from "./verdict";

const question = (id: string): Question => ({
  id,
  claimId: `claim-${id}`,
  ask: "What happens on retry?",
  mustMention: ["charged twice"],
  followUpIfVague: "Look at line 41.",
  location: { file: "src/webhook.ts", lines: [38, 44] },
});

describe("buildAnswers", () => {
  it("sends one typed answer for every question, in order", () => {
    const answers = buildAnswers([question("q1"), question("q2")], { q1: "It charges twice" });

    expect(answers).toEqual([
      { questionId: "q1", transcript: "It charges twice", mode: "typed" },
      { questionId: "q2", transcript: "", mode: "typed" },
    ]);
  });

  it("does not trim away what the person typed", () => {
    const [answer] = buildAnswers([question("q1")], { q1: "  spaced out  " });
    expect(answer?.transcript).toBe("  spaced out  ");
  });
});

describe("countUnanswered", () => {
  it("counts missing and whitespace-only answers", () => {
    const questions = [question("q1"), question("q2"), question("q3")];
    expect(countUnanswered(questions, { q1: "ok", q2: "   " })).toBe(2);
  });

  it("is zero when every question has an answer", () => {
    expect(countUnanswered([question("q1")], { q1: "ok" })).toBe(0);
  });
});

describe("pushAllowed", () => {
  it.each([
    ["approve", true],
    ["endorse", true],
    ["defer", false],
    ["reject", false],
  ] as const)("verdict %s allows the push: %s", (verdict, allowed) => {
    expect(pushAllowed({ verdict, reason: "exam-passed", skippable: true })).toBe(allowed);
  });
});
