import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FogMap, Review, ReviewCode, ReviewFeedback, SavedMemory } from "@viva/contracts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/mock/${name}`, import.meta.url), "utf8"));

/** ?mock parses these with the same schemas as live data, so a drift breaks the UI. */
describe("mock fixtures", () => {
  it("match the contract", () => {
    expect(() => FogMap.parse(fixture("fog.json"))).not.toThrow();
    expect(FogMap.parse(fixture("fog-empty.json"))).toMatchObject({ repoPath: null, nodes: [] });
    expect(() => Review.parse(fixture("review.json"))).not.toThrow();
    expect(Review.parse(fixture("review-hard-gate.json")).gate).toMatchObject({ skippable: false });
    expect(() => ReviewFeedback.parse(fixture("feedback.json"))).not.toThrow();
    expect(() => ReviewCode.parse(fixture("code.json"))).not.toThrow();
    expect(() => SavedMemory.parse(fixture("memory.json"))).not.toThrow();
  });

  it("show the code for the mock question", () => {
    const review = Review.parse(fixture("review.json"));
    const code = ReviewCode.parse(fixture("code.json"));
    const { file, lines } = review.plan!.questions[0]!.location;
    expect(code.reviewId).toBe(review.id);
    expect(code.file).toBe(file);
    expect(code.commit).toBe(review.request.head);
    const focused = code.lines.filter((line) => line.focus).map((line) => line.number);
    expect([focused[0], focused.at(-1)]).toEqual(lines);
  });
});
