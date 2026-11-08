import { describe, expect, it } from "vitest";
import type { Question, Review } from "@viva/contracts";
import { appendSpoken, examinerVariables, knownQuestion } from "./voice";
import { buildAnswers } from "./answers";

const question = (id: string): Question => ({
  id,
  claimId: `claim-${id}`,
  ask: "What happens on a duplicate event?",
  mustMention: ["charged twice"],
  followUpIfVague: "Look at the order of the calls.",
  location: { file: "src/webhook.js", lines: [6, 8] },
});
const review = { request: { person: "Marcus" } } as Review;

describe("examinerVariables", () => {
  it("never sends the rubric to the examiner", () => {
    const variables = examinerVariables(review, [question("q1")]);
    expect(JSON.stringify(variables)).not.toContain("charged twice");
    expect(variables).toMatchObject({ person: "Marcus", question_count: 1 });
    expect(JSON.parse(String(variables.questions))).toEqual([
      { id: "q1", ask: "What happens on a duplicate event?", follow_up_if_vague: "Look at the order of the calls.", code: "src/webhook.js lines 6-8" },
    ]);
  });
});

describe("appendSpoken", () => {
  it("adds speech after what was typed", () => expect(appendSpoken("It charges", " twice ")).toBe("It charges twice"));
  it("starts an empty answer", () => expect(appendSpoken(undefined, "Twice")).toBe("Twice"));
  it("ignores silence", () => expect(appendSpoken("kept", "  ")).toBe("kept"));
});

describe("knownQuestion", () => {
  it("accepts only IDs from this exam", () => {
    expect(knownQuestion([question("q1")], "q1")).toBe("q1");
    expect(knownQuestion([question("q1")], "q9")).toBeNull();
    expect(knownQuestion([question("q1")], 42)).toBeNull();
  });
});

describe("buildAnswers", () => {
  it("marks spoken answers as voice", () => {
    expect(buildAnswers([question("q1"), question("q2")], { q1: "a", q2: "b" }, new Set(["q2"])).map((a) => a.mode)).toEqual(["typed", "voice"]);
  });
});
