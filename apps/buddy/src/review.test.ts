import { Review } from "@viva/contracts";
import { describe, expect, it } from "vitest";
import failed from "../../../fixtures/mock/review-failed.json";
import hardGate from "../../../fixtures/mock/review-hard-gate.json";
import sample from "../../../fixtures/mock/review.json";
import { flagsFor, pushStats, riskLevel, riskPercent, sceneFor, tooShort } from "./review";

const pending = Review.parse(sample);

describe("riskPercent", () => {
  it("puts the exam threshold in the warning band and keeps climbing below 100", () => {
    expect(riskPercent(0)).toBe(0);
    expect(riskPercent(-1)).toBe(0);
    expect(riskPercent(Number.NaN)).toBe(0);
    expect(riskPercent(1)).toBe(60);
    expect(riskLevel(riskPercent(1))).toBe("mid");
    expect(riskPercent(0.5)).toBeLessThan(60);
    expect(riskPercent(3)).toBeGreaterThanOrEqual(85);
    expect(riskPercent(1000)).toBe(99);
  });
});

describe("the buddy's summary of a push", () => {
  it("counts decisions and files, and uses the riskiest claim", () => {
    expect(pushStats(pending)).toEqual({ decisions: 1, files: 1, risk: riskPercent(4.2) });
  });

  it("marks silent decisions and clips long summaries", () => {
    const long = { ...pending.claims[0]!, summary: "x".repeat(200) };
    const flags = flagsFor({ ...pending, claims: [long, { ...long, origin: "requested" }] });
    expect(flags.map((flag) => flag.silent)).toEqual([true, false]);
    expect(flags[0]!.text.length).toBeLessThanOrEqual(70);
    expect(flags[0]!.text.endsWith("…")).toBe(true);
  });
});

describe("sceneFor", () => {
  it("asks for a pending exam", () => {
    expect(sceneFor(pending).kind).toBe("ask");
  });

  it("never offers a skip for a hard gate", () => {
    const scene = sceneFor(Review.parse(hardGate));
    expect(scene).toMatchObject({ kind: "result", gate: { allowed: false, canSkip: false } });
  });

  it("offers a skip for a failed exam", () => {
    expect(sceneFor(Review.parse(failed))).toMatchObject({ kind: "result", gate: { allowed: false, canSkip: true } });
  });

  it("recognises a push that went ahead with debt", () => {
    const skipped = { ...pending, stage: "done" as const, gate: { verdict: "approve" as const, reason: "skipped-with-debt" as const, skippable: true } };
    expect(sceneFor(skipped)).toMatchObject({ kind: "result", skipped: true, gate: { allowed: true, canSkip: false } });
  });
});

it("nudges one-word answers", () => {
  expect(tooShort("  yes  ")).toBe(true);
  expect(tooShort("It retries after the charge, so it double charges")).toBe(false);
});
