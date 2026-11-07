import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { Question, Verdict } from "@viva/contracts";
import {
  fixtureRepo, gradeAnswer, grepBlastRadius, MeteredProvider, questionProblems, startReview, defaults,
  type CheckDefinition, type LlmProvider,
} from "@viva/engine";
import type { EvalCase } from "./cases/index.js";
import { seededClaim } from "./matrix.js";

/** One skimmed the diff, one bluffs with confidence. A rubric must be able to fail both. */
const WRONG_ANSWERS = [
  "Nothing really changes at runtime, it is the same behaviour with tidier code.",
  "It logs a warning and keeps the previous value, so callers never see any difference.",
];

export interface ExamRow {
  id: string;
  outcome: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  questions: number;
  /** Rule codes from questionProblems, never the question text. */
  problems: string[];
  onTarget: boolean;
  right?: Verdict;
  /** The most generous verdict either wrong answer received. */
  wrong?: Verdict;
  error?: boolean;
  rateLimited?: boolean;
}

const passes = (v?: Verdict) => v === "approve" || v === "endorse";

/** Each review runs the production pipeline, so the latency is what a developer waits. */
export async function runExamEval(
  cases: EvalCase[], checks: CheckDefinition[], llm: LlmProvider, onRow?: (row: ExamRow) => void, paceMs = 0,
): Promise<ExamRow[]> {
  const rows: ExamRow[] = [];
  const pause = (calls: number) => new Promise((resolve) => setTimeout(resolve, paceMs * calls));
  for (const c of cases) {
    const { repo, base, head } = fixtureRepo(c.before, c.after);
    const row: ExamRow = { id: c.id, outcome: "error", latencyMs: 0, inputTokens: 0, outputTokens: 0, questions: 0, problems: [], onTarget: false };
    try {
      const started = performance.now();
      const review = await startReview(
        { repoPath: repo, base, head, person: "eval", intent: c.intent },
        { llm, checks, session: { load: async () => null }, blast: grepBlastRadius, ledger: [] },
      );
      row.latencyMs = Math.round(performance.now() - started);
      row.inputTokens = review.usage.inputTokens;
      row.outputTokens = review.usage.outputTokens;
      row.outcome = review.stage === "awaiting-exam" ? "exam" : (review.gate?.reason ?? "none");
      const questions: Question[] = review.plan?.questions ?? [];
      row.questions = questions.length;
      row.problems = questions.flatMap(questionProblems);
      const seeded = c.expected && questions.find((q) => {
        const claim = review.claims.find((k) => k.id === q.claimId);
        return claim && seededClaim(c.expected!, [claim]);
      });
      await pause(review.usage.llmCalls);
      if (seeded && c.expected) {
        row.onTarget = true;
        const meter = new MeteredProvider(llm, defaults.maxInputTokens);
        const grade = (transcript: string) => gradeAnswer(seeded, { questionId: seeded.id, transcript, mode: "typed" }, meter);
        row.right = (await grade(c.expected.description)).verdict;
        await pause(1);
        for (const answer of WRONG_ANSWERS) {
          const { verdict } = await grade(answer);
          if (!row.wrong || passes(verdict)) row.wrong = verdict;
          await pause(1);
        }
        row.inputTokens += meter.usage.inputTokens;
        row.outputTokens += meter.usage.outputTokens;
      }
    } catch (error) {
      row.error = true;
      if (error instanceof Error && error.message.startsWith("Gemini returned 429")) {
        row.rateLimited = true;
        rows.push(row);
        onRow?.(row);
        break;
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
    rows.push(row);
    onRow?.(row);
  }
  return rows;
}

export function summarizeExam(rows: ExamRow[], cases: EvalCase[]) {
  const by = (keep: (c: EvalCase) => boolean) => rows.filter((r) => { const c = cases.find((k) => k.id === r.id); return c && !c.gate && keep(c); });
  const bugs = by((c) => c.expected !== null);
  const quiet = by((c) => c.expected === null);
  const graded = rows.filter((r) => r.right);
  const reviews = rows.filter((r) => r.latencyMs > 0 && !r.error);
  const sorted = reviews.map((r) => r.latencyMs).sort((a, b) => a - b);
  const pair = (n: number, d: number) => `${n}/${d}`;
  return {
    examsOnBugs: pair(bugs.filter((r) => r.outcome === "exam").length, bugs.length),
    onTarget: pair(bugs.filter((r) => r.onTarget).length, bugs.length),
    interruptedOnCleanOrRequested: pair(quiet.filter((r) => r.outcome === "exam").length, quiet.length),
    questions: rows.reduce((n, r) => n + r.questions, 0),
    questionsWithProblems: rows.reduce((n, r) => n + r.problems.length, 0),
    problemCodes: [...new Set(rows.flatMap((r) => r.problems))].sort(),
    rightAnswersPass: pair(graded.filter((r) => passes(r.right)).length, graded.length),
    wrongAnswersFail: pair(graded.filter((r) => !passes(r.wrong)).length, graded.length),
    medianLatencyMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    maxLatencyMs: sorted.at(-1) ?? 0,
    inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
    errors: rows.filter((r) => r.error).length,
  };
}
