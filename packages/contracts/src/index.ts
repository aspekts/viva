/**
 * The contract between the engine, the daemon and the UI.
 * Change this first, then update fixtures/mock so the frontend keeps working.
 */
import { z } from "zod";

/** Mabel-style verdicts, ordered from worst to best. */
export const VERDICTS = ["reject", "defer", "approve", "endorse"] as const;
export const Verdict = z.enum(VERDICTS);
export type Verdict = z.infer<typeof Verdict>;

/** Worst wins: any reject blocks, however many approvals surround it. */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  const rank = (v: Verdict) => VERDICTS.indexOf(v);
  return verdicts.reduce<Verdict>((w, v) => (rank(v) < rank(w) ? v : w), "endorse");
}

/** Where a decision came from, relative to what the human asked for. */
export const Origin = z.enum(["requested", "inferred", "silent"]);
export type Origin = z.infer<typeof Origin>;

export const CodeLocation = z.object({
  file: z.string(),
  lines: z.tuple([z.number().int().positive(), z.number().int().positive()]),
});
export type CodeLocation = z.infer<typeof CodeLocation>;

/** One decision found in a change. Produced by a check, ranked by risk. */
export const Claim = z.object({
  id: z.string(),
  check: z.string(),
  summary: z.string(),
  origin: Origin,
  symbols: z.array(z.string()),
  location: CodeLocation,
  evidence: z.string(),
});
export type Claim = z.infer<typeof Claim>;

export const RiskInputs = z.object({
  blastRadius: z.number().min(0),
  originWeight: z.number().min(0),
  untested: z.number().min(0).max(1),
  mastery: z.number().min(0).max(1),
});
export type RiskInputs = z.infer<typeof RiskInputs>;

export const RankedClaim = Claim.extend({ risk: z.number().min(0), inputs: RiskInputs });
export type RankedClaim = z.infer<typeof RankedClaim>;

/** Model output for a check. Parsed before use, never trusted as prose. */
export const CheckResult = z.object({ claims: z.array(Claim.omit({ id: true, check: true })) });
export type CheckResult = z.infer<typeof CheckResult>;

export const Question = z.object({
  id: z.string(),
  claimId: z.string(),
  ask: z.string(),
  mustMention: z.array(z.string()).min(1),
  followUpIfVague: z.string(),
  location: CodeLocation,
});
export type Question = z.infer<typeof Question>;

export const ExamPlan = z.object({ questions: z.array(Question).max(3) });
export type ExamPlan = z.infer<typeof ExamPlan>;

export const AnswerMode = z.enum(["voice", "typed"]);
export const Answer = z.object({
  questionId: z.string(),
  transcript: z.string(),
  mode: AnswerMode,
});
export type Answer = z.infer<typeof Answer>;

/** The grader sees the transcript and rubric only. Accent and fluency cannot reach it. */
export const Grade = z.object({
  questionId: z.string(),
  verdict: Verdict,
  score: z.number().min(0).max(1),
  missing: z.array(z.string()),
});
export type Grade = z.infer<typeof Grade>;

export const ReviewStage = z.enum([
  "collecting",
  "prechecks",
  "injection-scan",
  "checks",
  "planning",
  "awaiting-exam",
  "grading",
  "done",
]);
export type ReviewStage = z.infer<typeof ReviewStage>;

/** Why the gate decided what it did. Safe to log: it holds no diff or prose. */
export const GateReason = z.enum([
  "docs-only",
  "low-risk",
  "earned-trust",
  "too-large",
  "injection-suspected",
  "viva-config-changed",
  "exam-passed",
  "exam-failed",
  "skipped-with-debt",
  "pipeline-error",
]);
export type GateReason = z.infer<typeof GateReason>;

export const Gate = z.object({
  verdict: Verdict,
  reason: GateReason,
  /** False for hard gates, which config and "skip with debt" cannot bypass. */
  skippable: z.boolean(),
});
export type Gate = z.infer<typeof Gate>;

export const ReviewRequest = z.object({
  repoPath: z.string(),
  base: z.string(),
  head: z.string(),
  person: z.string(),
  intent: z.string().optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  llmCalls: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

export const Review = z.object({
  id: z.string(),
  request: ReviewRequest,
  stage: ReviewStage,
  claims: z.array(RankedClaim),
  plan: ExamPlan.nullable(),
  grades: z.array(Grade),
  gate: Gate.nullable(),
  usage: Usage,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Review = z.infer<typeof Review>;

/** Local retry receipt: no questions, model prose, diffs or answers on disk. */
export const ReviewDecision = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  reviewId: z.string().uuid(),
  gate: Gate,
  finishedAt: z.string(),
  /** Raised when older receipts can't be trusted. Missing on receipts written before policy 2. */
  policy: z.number().int().positive().optional(),
});
export type ReviewDecision = z.infer<typeof ReviewDecision>;

/** On-demand feedback stays in the review; it never enters the ledger. */
export const ReviewFeedback = z.object({
  reviewId: z.string(),
  gate: Gate,
  items: z.array(z.object({
    questionId: z.string(),
    location: CodeLocation,
    ask: z.string(),
    missing: z.array(z.string()),
  })),
});
export type ReviewFeedback = z.infer<typeof ReviewFeedback>;

/** Source for one location, read from the review's head commit. Never logged or stored. */
export const ReviewCode = z.object({
  reviewId: z.string(),
  file: z.string(),
  commit: z.string(),
  /** Lines in the whole file, not in this response. */
  totalLines: z.number().int().nonnegative(),
  lines: z.array(z.object({
    number: z.number().int().positive(),
    text: z.string(),
    /** True for the lines asked about, false for the context around them. */
    focus: z.boolean(),
  })),
  /** True when the location was too long and the end was cut off. */
  truncated: z.boolean(),
});
export type ReviewCode = z.infer<typeof ReviewCode>;

/**
 * One line of the ledger. Mirrors Mabel's data boundary: scores and hashes
 * leave the review, while diffs, transcripts and model output do not.
 */
export const Attestation = z.object({
  person: z.string(),
  symbol: z.string(),
  file: z.string(),
  codeHash: z.string(),
  score: z.number().min(0).max(1),
  at: z.string(),
  reviewId: z.string(),
});
export type Attestation = z.infer<typeof Attestation>;

/**
 * A passed answer the developer chose to keep as project memory, so a later
 * agent can find out why the code is the way it is. It lives in committed
 * markdown under `.viva/memory/`, never in the ledger, and is saved only on request.
 */
export const MemoryEntry = z.object({
  id: z.string(),
  reviewId: z.string(),
  questionId: z.string(),
  location: CodeLocation,
  symbols: z.array(z.string()),
  /** The decision the question was about. */
  claim: z.string(),
  question: z.string(),
  /** The developer's own words, as answered in the exam. */
  explanation: z.string(),
  person: z.string(),
  at: z.string(),
  /** The commit the explanation was given against. */
  commit: z.string(),
});
export type MemoryEntry = z.infer<typeof MemoryEntry>;

/** What a save wrote, so the developer sees exactly what is stored and where. */
export const SavedMemory = z.object({
  reviewId: z.string(),
  /** Repo-relative memory files, with forward slashes on every OS. */
  files: z.array(z.string()),
  entries: z.array(MemoryEntry),
});
export type SavedMemory = z.infer<typeof SavedMemory>;

export const FogNode = z.object({
  id: z.string(),
  file: z.string(),
  symbol: z.string().nullable(),
  size: z.number().nonnegative(),
  blastRadius: z.number().nonnegative(),
  /** 0 is fully understood, 1 is understood by nobody. */
  fog: z.number().min(0).max(1),
  knownBy: z.array(z.object({ person: z.string(), mastery: z.number().min(0).max(1) })),
});
export type FogNode = z.infer<typeof FogNode>;

export const FogMap = z.object({
  /** The repo mapped, or null when the daemon doesn't know one yet. Nodes are then empty. */
  repoPath: z.string().nullable(),
  generatedAt: z.string(),
  debt: z.number().nonnegative(),
  nodes: z.array(FogNode),
});
export type FogMap = z.infer<typeof FogMap>;

/** A signal to refetch over SSE, so no code, transcript or fog data travels in it. */
export const VivaEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("review"), reviewId: z.string(), stage: ReviewStage, gate: Gate.nullable() }),
  z.object({ type: z.literal("fog"), repoPath: z.string() }),
]);
export type VivaEvent = z.infer<typeof VivaEvent>;

/** GET /v1/voice/session: a short-lived ElevenLabs URL. 503 when voice isn't configured. */
export const VoiceSession = z.object({ signedUrl: z.string().url() });
export type VoiceSession = z.infer<typeof VoiceSession>;

