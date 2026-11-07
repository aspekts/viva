import { rm } from "node:fs/promises";
import { fixtureRepo, grepBlastRadius, startReview, type CheckDefinition, type LlmProvider } from "@viva/engine";
import { directionCases } from "./cases/direction.js";

/** Decision memory evals. With the mock provider they prove retrieval, wiring and token use, not judgement. */
export async function runDirectionEvals(llm: LlmProvider, checks: CheckDefinition[]) {
  const rows = [];
  for (const c of directionCases) {
    const { repo, base, head } = fixtureRepo(c.before, c.after);
    try {
      const review = await startReview(
        { repoPath: repo, base, head, person: "eval", intent: c.intent },
        { llm, checks, session: { load: async () => null }, blast: grepBlastRadius, ledger: [] },
      );
      const outcome = review.stage === "awaiting-exam" ? "exam" : (review.gate?.reason ?? "none");
      const direction = review.claims.some((claim) => claim.check === "direction");
      const tag = (o: string, d: boolean) => `${o}${d ? " (direction)" : ""}`;
      rows.push({
        name: c.name,
        want: `${tag(c.expect, c.direction)}, ${c.llmCalls} calls`,
        got: `${tag(outcome, direction)}, ${review.usage.llmCalls} calls`,
        pass: outcome === c.expect && direction === c.direction && review.usage.llmCalls === c.llmCalls,
        tokens: review.usage.inputTokens,
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
  return rows;
}
