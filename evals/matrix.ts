import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { Claim } from "@viva/contracts";
import {
  defaults, fixtureRepo, loadChange, MeteredProvider, runChecks, runPrechecks, scanForInjection,
  type CheckDefinition, type LlmProvider,
} from "@viva/engine";
import { checkNames, type CheckName, type EvalCase, type ExpectedClaim } from "./cases/index.js";

export type Status = "HIT" | "MISS" | "CLEAR" | "FP" | "EXTRA" | "GATE" | "ERROR" | "NOT-RUN";
export interface Cell {
  check: CheckName;
  status: Status;
  claims: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  outputHash?: string;
  error?: string;
}
export interface Row {
  id: string;
  kind: "bug" | "clean";
  fixtureHash: string;
  gate?: string;
  cells: Cell[];
}
export interface Matrix {
  provider: string;
  model: string;
  date: string;
  checkHashes: Record<string, string>;
  rows: Row[];
  stopped: boolean;
}

export const hash = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value, (_key, item) => item instanceof RegExp ? item.toString() : item)).digest("hex");

/** Never count unrelated findings, or concepts scattered over several claims. */
export function matchesClaim(expected: ExpectedClaim, claim: Claim, check: CheckName): boolean {
  const [start, end] = claim.location.lines;
  return claim.location.file === expected.file
    && start <= end && start <= expected.lines[1] && end >= expected.lines[0]
    && (check !== "silent-decision" || claim.origin === "silent")
    && expected.concepts.every((concept) => concept.test(`${claim.summary}\n${claim.evidence}`));
}

export function gradeClaims(c: EvalCase, check: CheckName, claims: Claim[]): Status {
  if (!c.expected) return claims.length === 0 ? "CLEAR" : "FP";
  if (!c.expected.checks.includes(check)) return claims.length === 0 ? "CLEAR" : "EXTRA";
  return claims.some((claim) => matchesClaim(c.expected!, claim, check)) ? "HIT" : "MISS";
}

/** No provider error bodies or model prose can reach stdout or the report. */
export function safeError(error: unknown): string {
  if (error instanceof Error && /Gemini returned \d{3}/.test(error.message)) {
    return /Gemini returned \d{3}/.exec(error.message)![0];
  }
  if (error instanceof Error && error.name === "ZodError") return "schema-validation";
  if (error instanceof SyntaxError) return "invalid-json";
  return "provider-or-harness-error";
}

export async function runMatrix(
  cases: EvalCase[], checks: CheckDefinition[], llm: LlmProvider, model: string,
  onRow?: (row: Row) => void,
): Promise<Matrix> {
  for (const name of checkNames) {
    if (!checks.some((check) => check.name === name)) throw new Error(`Missing check: ${name}`);
  }
  const result: Matrix = {
    provider: llm.id, model, date: new Date().toISOString(),
    checkHashes: Object.fromEntries(checks.map((c) => [c.name, hash(c.prompt)])), rows: [], stopped: false,
  };
  for (const c of cases) {
    const row: Row = {
      id: c.id, kind: c.expected ? "bug" : "clean", fixtureHash: hash(c),
      cells: [],
    };
    if (result.stopped) {
      row.cells = checkNames.map((check) => emptyCell(check, "NOT-RUN"));
    } else {
      const { repo, base, head } = fixtureRepo(c.before, c.after);
      try {
        const change = await loadChange(repo, base, head);
        const gate = runPrechecks(change, defaults) ?? scanForInjection(change.diff);
        if (gate) {
          row.gate = gate.reason;
          row.cells = checkNames.map((check) => emptyCell(check, "GATE"));
        } else {
          for (const name of checkNames) {
            if (result.stopped) {
              row.cells.push(emptyCell(name, "NOT-RUN"));
              continue;
            }
            const meter = new MeteredProvider(llm, defaults.maxInputTokens);
            const started = performance.now();
            try {
              // Exactly the production check, schema and untrusted wrappers. One at a time.
              const claims = await runChecks([checks.find((check) => check.name === name)!], change,
                { source: "request", intent: c.intent, transcript: null }, meter);
              row.cells.push({
                check: name, status: gradeClaims(c, name, claims), claims: claims.length,
                latencyMs: Math.round(performance.now() - started),
                inputTokens: meter.usage.inputTokens, outputTokens: meter.usage.outputTokens,
                outputHash: hash(claims),
              });
            } catch (error) {
              const category = safeError(error);
              row.cells.push({ ...emptyCell(name, "ERROR"), latencyMs: Math.round(performance.now() - started), error: category });
              if (category === "Gemini returned 429") result.stopped = true;
            }
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    }
    result.rows.push(row);
    onRow?.(row);
  }
  return result;
}

function emptyCell(check: CheckName, status: Status): Cell {
  return { check, status, claims: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0 };
}

const completed = (cell: Cell) => !["GATE", "ERROR", "NOT-RUN"].includes(cell.status);
const rate = (n: number, d: number) => d ? `${n}/${d} (${(100 * n / d).toFixed(1)}%)` : "n/a (0 observations)";

export function summarize(matrix: Matrix, cases: EvalCase[]) {
  const bugs = matrix.rows.filter((row) => row.kind === "bug");
  const clean = matrix.rows.filter((row) => row.kind === "clean" && !row.gate);
  const measuredClean = clean.filter((row) => row.cells.every(completed));
  const measuredBugs = bugs.filter((row) => row.cells.every(completed));
  const found = bugs.filter((row) => row.cells.some((cell) => cell.status === "HIT")).length;
  const fp = measuredClean.filter((row) => row.cells.some((cell) => cell.status === "FP")).length;
  const cells = matrix.rows.flatMap((row) => row.cells);
  return {
    recall: rate(found, cases.filter((c) => c.expected).length),
    observedRecall: rate(measuredBugs.filter((r) => r.cells.some((c) => c.status === "HIT")).length, measuredBugs.length),
    falsePositiveRate: rate(fp, measuredClean.length),
    complete: !matrix.stopped && cells.every((c) => c.status !== "ERROR" && c.status !== "NOT-RUN")
      && matrix.rows.every((r) => r.gate === cases.find((c) => c.id === r.id)?.gate),
    inputTokens: cells.reduce((n, c) => n + c.inputTokens, 0),
    outputTokens: cells.reduce((n, c) => n + c.outputTokens, 0),
    latencyMs: cells.reduce((n, c) => n + c.latencyMs, 0),
    calls: cells.filter((c) => completed(c) || c.status === "ERROR").length,
    perCheck: checkNames.map((check) => {
      const positives = matrix.rows.filter((r) => cases.find((c) => c.id === r.id)?.expected?.checks.includes(check));
      const observed = positives.filter((r) => r.cells.some((c) => c.check === check && completed(c)));
      return {
        check, recall: rate(positives.filter((r) => r.cells.some((c) => c.check === check && c.status === "HIT")).length, positives.length),
        observedRecall: rate(observed.filter((r) => r.cells.some((c) => c.check === check && c.status === "HIT")).length, observed.length),
        falsePositiveRate: rate(measuredClean.filter((r) => r.cells.some((c) => c.check === check && c.status === "FP")).length, measuredClean.length),
      };
    }),
  };
}

export function formatRow(row: Row): string {
  const total = (key: "latencyMs" | "inputTokens" | "outputTokens") => row.cells.reduce((n, c) => n + c[key], 0);
  return `| ${row.id} | ${row.cells.map((c) => c.status).join(" | ")} | ${total("latencyMs")} | ${total("inputTokens")} / ${total("outputTokens")} |`;
}

export function report(matrix: Matrix, cases: EvalCase[]): string {
  const s = summarize(matrix, cases);
  const failures = matrix.rows.flatMap((row) => row.cells
    .filter((c) => ["MISS", "FP", "EXTRA", "ERROR", "NOT-RUN"].includes(c.status))
    .map((c) => `- **${row.id} / ${c.check}: ${c.status}**; ${c.claims} claims.${c.error ? ` Error: ${c.error}.` : ""}`));
  for (const row of matrix.rows) {
    const wantedGate = cases.find((c) => c.id === row.id)?.gate;
    if (row.cells.some((c) => c.status !== "NOT-RUN") && row.gate !== wantedGate) {
      failures.push(`- **${row.id}: unexpected gate**; expected ${wantedGate ?? "none"}, got ${row.gate ?? "none"}.`);
    }
  }
  return `# Live check evals\n\n` +
    `## Recorded run\n\n` +
    `- Date (UTC): ${matrix.date}\n- Provider: ${matrix.provider}; configured model: ${matrix.model}\n` +
    `- Run complete: **${s.complete ? "yes" : "no — do not treat missing observations as model successes"}**\n` +
    `- Full-corpus detection lower bound (any check finds the expected claim; unmeasured cases remain in denominator): **${s.recall}**\n` +
    `- Recall on fully observed bug cases: **${s.observedRecall}**\n` +
    `- False-positive rate (any claim on fully observed clean code cases): **${s.falsePositiveRate}**\n` +
    `- Sequential check latency: **${s.latencyMs} ms** total; ${s.calls ? Math.round(s.latencyMs / s.calls) : 0} ms mean per attempted cell\n` +
    `- Check calls attempted: ${s.calls} (provider may retry transient non-429 failures); reported tokens: **${s.inputTokens} input / ${s.outputTokens} output**\n` +
    `- Failed requests have unknown token usage, not an observed zero. Output tokens are Gemini's candidatesTokenCount; internal thinking tokens are not included.\n\n` +
    `| Check | Full-corpus detection lower bound | Recall on observed target cells | Clean-code false-positive rate |\n| --- | --- | --- | --- |\n` +
    s.perCheck.map((c) => `| ${c.check} | ${c.recall} | ${c.observedRecall} | ${c.falsePositiveRate} |`).join("\n") +
    `\n\n## Check-by-case matrix\n\n| Case | behaviour-change | failure-path | silent-decision | Latency ms | Tokens in / out |\n| --- | --- | --- | --- | ---: | ---: |\n` +
    matrix.rows.map(formatRow).join("\n") +
    `\n\nHIT = anchored expected claim found; MISS = expected claim not matched (even if another claim exists); CLEAR = no claim expected or emitted; FP = clean code flagged; EXTRA = off-scope check emitted a claim on a bug case; GATE = deterministic bypass; ERROR / NOT-RUN = unmeasured. EXTRA is reported but excluded from the clean-case FP denominator.\n\n` +
    `## Every failure / unexpected finding\n\n${failures.join("\n") || "None."}\n\n` +
    `## Fixed case rubric\n\n` + cases.map((c) => `- **${c.id}**: ${c.expected ? `${c.expected.description} Anchor: \`${c.expected.file}:${c.expected.lines.join("-")}\`; target checks: ${c.expected.checks.join(", ")}. Required concept groups: ${c.expected.concepts.map(String).map((r) => `\`${r}\``).join(" AND ")}.` : c.gate ? "Docs-only; must bypass all model checks." : "Clean refactor; every check must return zero claims."}`).join("\n") +
    `\n\n## Method and reproduction\n\n` +
    "- `pnpm evals` stays offline: the original six pipeline smoke cases assert deterministic mock behaviour; this matrix also runs with MockProvider, whose scores are NOT model-quality evidence. Mock matrix scores do not gate CI.\n" +
    "- Run `pnpm evals:live --report docs/EVALS.md` to explicitly use Gemini. Loads root .env (existing environment wins); skips successfully without GEMINI_API_KEY. GEMINI_MODEL defaults to gemini-3.5-flash-lite. No fallback model is used, keeping attribution unambiguous.\n" +
    `- Each cell calls production runChecks with exactly one unchanged check markdown prompt and the production zod schema/untrusted wrappers. Checks and cases are sequential. The first 429 stops the entire run, without retrying the 429 or falling back. Deterministic prechecks and injection scan run first; docs bypass is excluded from model clean-case metrics.\n` +
    `- Fixtures are hand-written before/after files committed to temporary Git repositories; production loadChange generates the diff. Repositories are removed afterwards. No code from fixtures is installed or executed.\n` +
    `- The hand-authored expected claim/rubric is never sent to the model. One claim must overlap the fixed file/line anchor and match ALL concept regexes in its summary/evidence; silent-decision must also label it silent. No model grades another model.\n` +
    `- This lexical score is reproducible but can reject correct paraphrases and accept sufficiently similar incorrect prose. It measures seeded claim detection, not exam-question usefulness, correctness of all extra claims, or end-to-end planning/risk thresholds. One small, single-run corpus is not a general accuracy estimate. No check prompts were tuned for this run.\n` +
    `- Only score/count/timing metadata and hashes are retained. No raw model output, repository diffs, transcripts, API error bodies, or secrets are logged or stored in this report.\n\n` +
    `## Provenance (SHA-256)\n\n` +
    `Check prompt hashes:\n\n${Object.entries(matrix.checkHashes).map(([name, h]) => `- ${name}: ${h}`).join("\n")}\n\n` +
    `| Case | Fixture + rubric hash | Per-check output hashes (matrix order; — means no parsed output) |\n| --- | --- | --- |\n` +
    matrix.rows.map((r) => `| ${r.id} | ${r.fixtureHash} | ${r.cells.map((c) => c.outputHash ?? "—").join(" / ")} |`).join("\n") + "\n";
}
