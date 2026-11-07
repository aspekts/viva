import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fixtureRepo, GeminiProvider, grepBlastRadius, loadChecks, MockProvider, startReview,
  type LlmProvider,
} from "@viva/engine";
import { cases } from "./cases/index.js";
import { smokeCases } from "./cases/smoke.js";
import { formatRow, report, runMatrix, safeError, summarize } from "./matrix.js";

const CHECKS_DIR = fileURLToPath(new URL("../checks", import.meta.url));

/** Original offline pipeline assertions, separate from model-quality scoring. */
export async function runEvals(llm: LlmProvider = new MockProvider()) {
  const checks = await loadChecks(CHECKS_DIR);
  const rows = [];
  for (const c of smokeCases) {
    const { repo, base, head } = fixtureRepo(c.before, c.after);
    try {
      const review = await startReview(
        { repoPath: repo, base, head, person: "eval", intent: c.intent },
        { llm, checks, session: { load: async () => null }, blast: grepBlastRadius, ledger: [] },
      );
      const got = review.stage === "awaiting-exam" ? "exam" : (review.gate?.reason ?? "none");
      rows.push({ name: c.name, want: c.expect, got, pass: got === c.expect });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
  return rows;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const live = args.includes("--live");
  const reportAt = args.indexOf("--report");
  const reportPath = reportAt >= 0 ? args[reportAt + 1] : undefined;
  if ((reportAt >= 0 && (!reportPath || reportPath.startsWith("--"))) || (reportPath && !live)) {
    throw new Error("--report requires --live and a file path");
  }
  let llm: LlmProvider = new MockProvider();
  let model = "deterministic mock (NOT model quality)";
  if (live) {
    try {
      process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not load .env");
    }
    if (!process.env.GEMINI_API_KEY) {
      console.log("SKIP live evals: GEMINI_API_KEY is not configured. No API calls made.");
      return 0;
    }
    model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    // Disable 429 retries and fallback: this is a shared free-tier key.
    llm = new GeminiProvider(process.env.GEMINI_API_KEY, model, undefined, 800, false);
  } else {
    const smoke = await runEvals();
    console.table(smoke);
    if (smoke.some((r) => !r.pass)) return 1;
    console.log(`${smoke.length}/${smoke.length} pipeline smoke assertions passed (mock only).`);
  }
  console.log(`Provider: ${llm.id}; model: ${model}. Sequential check calls.`);
  console.log("| Case | behaviour-change | failure-path | silent-decision | Latency ms | Tokens in / out |");
  console.log("| --- | --- | --- | --- | ---: | ---: |");
  const matrix = await runMatrix(cases, await loadChecks(CHECKS_DIR), llm, model,
    (row) => console.log(formatRow(row)));
  const summary = summarize(matrix, cases);
  console.log(`Full-corpus detection lower bound: ${summary.recall}; observed case recall: ${summary.observedRecall}; clean-code false-positive rate: ${summary.falsePositiveRate}.`);
  console.log(`Tokens: ${summary.inputTokens} in / ${summary.outputTokens} out; check latency: ${summary.latencyMs} ms.`);
  if (reportPath) await writeFile(resolve(reportPath), report(matrix, cases), "utf8");
  if (!live) {
    console.log("Mock matrix scores are harness diagnostics, not quality assertions. Use pnpm evals:live for Gemini.");
    return summary.complete ? 0 : 1;
  }
  // Poor quality is a valid result, but make it machine-visible to callers.
  const qualityFailure = matrix.rows.some((r) => r.cells.some((c) => ["MISS", "FP", "EXTRA"].includes(c.status)));
  return summary.complete && !qualityFailure ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(`Eval runner failed: ${safeError(error)}. No raw error body logged.`);
    process.exitCode = 1;
  });
}
