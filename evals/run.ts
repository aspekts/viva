import { fileURLToPath } from "node:url";
import { fixtureRepo, grepBlastRadius, loadChecks, MockProvider, startReview, type LlmProvider } from "@viva/engine";
import { cases } from "./cases/index.js";
import { runDirectionEvals } from "./direction.js";

/**
 * Tests for prompts. With the mock provider this proves the harness and the
 * deterministic stages only. Run with a real provider to grade the checks.
 */
const CHECKS_DIR = fileURLToPath(new URL("../checks", import.meta.url));

export async function runEvals(llm: LlmProvider = new MockProvider()) {
  const checks = await loadChecks(CHECKS_DIR);
  const rows = [];
  for (const c of cases) {
    const { repo, base, head } = fixtureRepo(c.before, c.after);
    const review = await startReview(
      { repoPath: repo, base, head, person: "eval", intent: c.intent },
      { llm, checks, session: { load: async () => null }, blast: grepBlastRadius, ledger: [] },
    );
    const got = review.stage === "awaiting-exam" ? "exam" : (review.gate?.reason ?? "none");
    rows.push({ name: c.name, want: c.expect, got, pass: got === c.expect, tokens: review.usage.inputTokens });
  }
  return rows;
}

const rows = [...await runEvals(), ...await runDirectionEvals(new MockProvider(), await loadChecks(CHECKS_DIR))];
console.table(rows);
const failed = rows.filter((r) => !r.pass);
console.log(`${rows.length - failed.length}/${rows.length} passed (provider: mock)`);
process.exit(failed.length ? 1 : 0);
