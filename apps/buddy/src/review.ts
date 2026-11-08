import type { Review } from "@viva/contracts";
import { describeGate, type GateView } from "../../web/src/exam/gate";

/**
 * The engine's risk score is unbounded and the exam threshold is 1. The buddy's
 * meter shows it as 0 to 99, with the threshold at 60, so a score that needs a
 * viva always lands in the warning band and higher scores climb towards the top.
 */
export const RISK_AT_THRESHOLD = 60;
export function riskPercent(risk: number): number {
  if (!(risk > 0)) return 0;
  const percent = 100 * (1 - (1 - RISK_AT_THRESHOLD / 100) ** risk);
  return Math.min(99, Math.round(percent));
}

export type RiskLevel = "low" | "mid" | "high";
export const riskLevel = (percent: number): RiskLevel => (percent >= 85 ? "high" : percent >= RISK_AT_THRESHOLD ? "mid" : "low");

export interface Flag {
  text: string;
  /** The agent did it without being asked: the headline. */
  silent: boolean;
}

const MAX_FLAGS = 4;
const MAX_FLAG_LENGTH = 70;
const clip = (text: string) => (text.length > MAX_FLAG_LENGTH ? `${text.slice(0, MAX_FLAG_LENGTH - 1).trimEnd()}…` : text);

/** Claim summaries are model output about repository code: shown as plain text, never as markup. */
export function flagsFor(review: Review): Flag[] {
  return review.claims.slice(0, MAX_FLAGS).map((claim) => ({ text: clip(claim.summary), silent: claim.origin === "silent" }));
}

export interface PushStats {
  decisions: number;
  files: number;
  risk: number;
}

export function pushStats(review: Review): PushStats {
  const top = review.claims.reduce((max, claim) => Math.max(max, claim.risk), 0);
  return {
    decisions: review.claims.length,
    files: new Set(review.claims.map((claim) => claim.location.file)).size,
    risk: riskPercent(top),
  };
}

/**
 * Which scene the buddy plays. Only `awaiting-exam` and `done` are observable from the daemon.
 * Hard gates are decided before an exam, so a pending exam can always be skipped with debt.
 */
export type Scene =
  | { kind: "ask" }
  | { kind: "result"; gate: GateView; skipped: boolean }
  | { kind: "pending" };

export function sceneFor(review: Review): Scene {
  if (review.stage === "awaiting-exam" && review.plan) return { kind: "ask" };
  if (review.gate) return { kind: "result", gate: describeGate(review.gate), skipped: review.gate.reason === "skipped-with-debt" };
  return { kind: "pending" };
}

/** A UX nudge before submitting, not grading: the grader alone decides what an answer is worth. */
export const MIN_ANSWER = 8;
export const tooShort = (answer: string) => answer.trim().length < MIN_ANSWER;
