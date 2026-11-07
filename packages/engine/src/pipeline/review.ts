import { randomUUID } from "node:crypto";
import type { Answer, Attestation, Claim, Gate, MemoryEntry, Review, ReviewRequest } from "@viva/contracts";
import { defaults, type VivaConfig } from "../config.js";
import { masteryFor } from "../ledger/mastery.js";
import { MeteredProvider, type LlmProvider } from "../llm/provider.js";
import { relevantMemory } from "../memory/retrieve.js";
import { blobHash, loadChange } from "../sources/git.js";
import type { BlastRadiusSource } from "../sources/graph.js";
import { resolveSession, type SessionSource } from "../sources/session.js";
import { aggregateGrades } from "./aggregate.js";
import { runChecks, type CheckDefinition } from "./checks.js";
import { gradeAnswer } from "./grade.js";
import { scanForInjection } from "./injection.js";
import { planExam } from "./plan.js";
import { runPrechecks } from "./prechecks.js";
import { rankClaims } from "./risk.js";

export interface ReviewDeps {
  llm: LlmProvider;
  checks: CheckDefinition[];
  session: SessionSource;
  blast: BlastRadiusSource;
  ledger: Attestation[];
  config?: VivaConfig;
  now?: () => Date;
  /** Recorded decisions for the changed files, as of the push's base. Defaults to reading `.viva/memory/` from git. */
  memory?: (repoPath: string, base: string, files: string[]) => Promise<MemoryEntry[]>;
}

const finish = (review: Review, gate: Gate, now: Date): Review => ({
  ...review,
  stage: "done",
  gate,
  finishedAt: now.toISOString(),
});

/** Runs a review up to the exam. Stops early wherever a cheaper step can decide. */
export async function startReview(request: ReviewRequest, deps: ReviewDeps): Promise<Review> {
  const config = deps.config ?? defaults;
  const now = deps.now ?? (() => new Date());
  const llm = new MeteredProvider(deps.llm, config.maxInputTokens);
  let review: Review = {
    id: randomUUID(),
    request,
    stage: "collecting",
    claims: [],
    plan: null,
    grades: [],
    gate: null,
    usage: llm.usage,
    startedAt: now().toISOString(),
    finishedAt: null,
  };

  const change = await loadChange(request.repoPath, request.base, request.head);

  const precheck = runPrechecks(change, config);
  if (precheck) return finish(review, precheck, now());

  const injection = scanForInjection(change.diff);
  if (injection) return finish(review, injection, now());

  const session = await resolveSession(deps.session, request.repoPath, request.head, request.intent);
  // Deterministic, before any model call. Read at base only, so the push can't write the memory it is judged by.
  // Missing or broken memory must never block a push.
  const memory = await (deps.memory ?? relevantMemory)(request.repoPath, request.base, change.files.map((f) => f.path))
    .catch(() => []);
  const claims = await runChecks(deps.checks, change, session, llm, memory);
  // Knowing the code, or having asked for the change, doesn't settle whether reversing a
  // recorded decision is the right direction. So these claims ignore mastery and always
  // reach the exam, rather than depending on the risk threshold.
  const memoryChecks = new Set(deps.checks.filter((c) => c.needs === "memory").map((c) => c.name));
  const reversesMemory = (claim: Claim) => memoryChecks.has(claim.check);

  const inputs = new Map<string, number>();
  const hashes = new Map<string, string | null>();
  await Promise.all(
    claims.map(async (c: Claim) => {
      inputs.set(c.id, await deps.blast.measure(request.repoPath, request.head, c.symbols, c.location.file));
      const hash = await blobHash(request.repoPath, request.head, c.location.file).catch(() => null);
      hashes.set(c.location.file, hash);
    }),
  );
  const tested = change.files.some((f) => /(\.test\.|\.spec\.|(^|\/)tests?\/)/.test(f.path));
  const ranked = rankClaims(
    claims,
    (claim) => ({
      blastRadius: inputs.get(claim.id) ?? 0,
      untested: tested ? 0.25 : 1,
      mastery: reversesMemory(claim)
        ? 0
        : masteryFor(deps.ledger, request.person, claim.location.file, hashes.get(claim.location.file) ?? null, now(), config),
    }),
    config,
    reversesMemory,
  );
  review = { ...review, claims: ranked };

  // Ranked claims put reversals of recorded decisions first, so they always fit within maxQuestions.
  const risky = ranked.filter((c) => reversesMemory(c) || c.risk >= config.riskThreshold).slice(0, config.maxQuestions);
  if (risky.length === 0) {
    const earned = ranked.length > 0 && ranked.every((c) => c.inputs.mastery > 0.5);
    return finish(
      review,
      { verdict: "approve", reason: earned ? "earned-trust" : "low-risk", skippable: true },
      now(),
    );
  }

  const plan = await planExam(risky, llm);
  return { ...review, stage: "awaiting-exam", plan };
}

/** Grades the answers, applies worst-wins, and returns attestations for the ledger. */
export async function submitAnswers(
  review: Review,
  answers: Answer[],
  deps: Pick<ReviewDeps, "llm" | "config" | "now">,
): Promise<{ review: Review; attestations: Attestation[] }> {
  const config = deps.config ?? defaults;
  const now = deps.now ?? (() => new Date());
  if (review.stage !== "awaiting-exam" || !review.plan) throw new Error("review is not awaiting an exam");

  const llm = new MeteredProvider(deps.llm, config.maxInputTokens);
  const grades = await Promise.all(
    review.plan.questions.map((question) => {
      const answer = answers.find((a) => a.questionId === question.id);
      return gradeAnswer(question, answer ?? { questionId: question.id, transcript: "", mode: "typed" }, llm);
    }),
  );

  const attestations: Attestation[] = await Promise.all(
    grades.map(async (grade) => {
      const question = review.plan?.questions.find((q) => q.id === grade.questionId);
      const claim = review.claims.find((c) => c.id === question?.claimId);
      const file = question?.location.file ?? "";
      return {
        person: review.request.person,
        symbol: claim?.symbols[0] ?? file,
        file,
        codeHash: await blobHash(review.request.repoPath, review.request.head, file).catch(() => "unknown"),
        score: grade.score,
        at: now().toISOString(),
        reviewId: review.id,
      };
    }),
  );

  const usage = {
    inputTokens: review.usage.inputTokens + llm.usage.inputTokens,
    outputTokens: review.usage.outputTokens + llm.usage.outputTokens,
    llmCalls: review.usage.llmCalls + llm.usage.llmCalls,
  };
  return { review: finish({ ...review, grades, usage }, aggregateGrades(grades), now()), attestations };
}

/** Skip with debt: the push goes ahead, the fog stays, and hard gates refuse. */
export function skipWithDebt(review: Review, now: Date = new Date()): Review {
  if (review.gate && !review.gate.skippable) throw new Error("this gate cannot be skipped");
  return finish(review, { verdict: "approve", reason: "skipped-with-debt", skippable: true }, now);
}
