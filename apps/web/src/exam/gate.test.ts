import { GateReason, type Gate } from "@viva/contracts";
import { describe, expect, it } from "vitest";
import type { Review } from "@viva/contracts";
import { describeGate, newerReview, skipErrorMessage } from "./gate";
import { ApiError } from "../api/errors";

const gate = (reason: GateReason, verdict: Gate["verdict"], skippable = true): Gate => ({ reason, verdict, skippable });

describe("describeGate", () => {
  it.each(GateReason.options)("has copy for %s", (reason) => {
    const { title, detail } = describeGate(gate(reason, "reject"));
    expect(title.length).toBeGreaterThan(0);
    expect(detail.length).toBeGreaterThan(0);
  });

  it("allows the push on approve and endorse only", () => {
    expect(describeGate(gate("exam-passed", "approve")).allowed).toBe(true);
    expect(describeGate(gate("docs-only", "endorse")).allowed).toBe(true);
    expect(describeGate(gate("exam-failed", "reject")).allowed).toBe(false);
    expect(describeGate(gate("too-large", "defer")).allowed).toBe(false);
  });

  it("offers skip only when blocked and skippable", () => {
    expect(describeGate(gate("exam-failed", "reject")).canSkip).toBe(true);
    expect(describeGate(gate("injection-suspected", "defer", false)).canSkip).toBe(false);
    expect(describeGate(gate("viva-config-changed", "defer", false)).canSkip).toBe(false);
    expect(describeGate(gate("skipped-with-debt", "approve")).canSkip).toBe(false);
  });

  it("never offers skip when the daemon says it is not skippable, whatever the verdict", () => {
    expect(describeGate(gate("exam-failed", "reject", false)).canSkip).toBe(false);
  });

  it("says a person must look at a hard gate", () => {
    expect(describeGate(gate("injection-suspected", "defer", false)).detail).toMatch(/person/i);
  });
});

describe("skipErrorMessage", () => {
  it("says the review cannot be skipped on a 409", () => {
    expect(skipErrorMessage(new ApiError(409, "no"))).toMatch(/cannot be skipped/);
  });

  it("asks for a new push on a 404", () => {
    expect(skipErrorMessage(new ApiError(404, "gone"))).toContain("git push");
  });

  it("suggests a retry otherwise", () => {
    expect(skipErrorMessage(new ApiError(500, "boom"))).toContain("Try again");
    expect(skipErrorMessage(new Error("offline"))).toContain("Try again");
  });
});

describe("describeGate copy", () => {
  it("only mentions pushing on when skip is on offer", () => {
    expect(describeGate(gate("exam-failed", "reject")).detail).toMatch(/push on/i);
    expect(describeGate(gate("exam-failed", "reject", false)).detail).not.toMatch(/push on/i);
    expect(describeGate(gate("too-large", "defer", false)).detail).not.toMatch(/push on/i);
  });
});

describe("newerReview", () => {
  const review = (id: string, reason: Gate["reason"], verdict: Gate["verdict"]): Review =>
    ({ id, gate: { reason, verdict, skippable: true } }) as Review;
  const skipped = review("a", "skipped-with-debt", "approve");
  const failed = review("a", "exam-failed", "reject");

  it("drops a stale blocked read after a skip", () => {
    expect(newerReview(skipped, failed)).toBe(skipped);
  });

  it("accepts anything else", () => {
    expect(newerReview(null, failed)).toBe(failed);
    expect(newerReview(failed, skipped)).toBe(skipped);
    expect(newerReview(skipped, review("b", "exam-failed", "reject")).id).toBe("b");
  });
});
