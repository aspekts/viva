import { rm } from "node:fs/promises";
import { fixtureRepo, grepBlastRadius, startReview, type CheckDefinition, type LlmProvider } from "@viva/engine";
import { directionCases } from "./cases/direction.js";

/** A planner that never asks about direction claims, still returning a schema-valid plan. */
function skippingDirection(llm: LlmProvider): LlmProvider {
  return {
    id: llm.id,
    async complete(request) {
      const result = await llm.complete(request);
      if (request.name !== "plan") return result;
      const plan = result.value as { questions: { claimId: string }[] };
      const questions = plan.questions.filter((q) => !q.claimId.startsWith("direction-"));
      return { ...result, value: request.schema.parse({ ...plan, questions }) };
    },
  };
}

/** Decision memory evals. With the mock provider they prove retrieval, wiring and token use, not judgement. */
export async function runDirectionEvals(llm: LlmProvider, checks: CheckDefinition[]) {
  const rows = [];
  for (const c of directionCases) {
    const { repo, base, head } = fixtureRepo(c.before, c.after);
    try {
      const review = await startReview(
        { repoPath: repo, base, head, person: "eval", intent: c.intent },
        { llm: c.plannerSkipsDirection ? skippingDirection(llm) : llm, checks, session: { load: async () => null }, blast: grepBlastRadius, ledger: [] },
      );
      const outcome = review.stage === "awaiting-exam" ? "exam" : (review.gate?.reason ?? "none");
      const direction = review.claims.some((claim) => claim.check === "direction");
      // A raised reversal must be in the exam itself, not only among the claims.
      const asked = !direction || outcome !== "exam" || (review.plan?.questions ?? []).some((q) =>
        review.claims.find((claim) => claim.id === q.claimId)?.check === "direction");
      const tag = (o: string, d: boolean) => `${o}${d ? " (direction)" : ""}`;
      rows.push({
        name: c.name,
        want: `${tag(c.expect, c.direction)}, ${c.llmCalls} calls`,
        got: `${tag(outcome, direction)}${asked ? "" : " not asked"}, ${review.usage.llmCalls} calls`,
        pass: asked && outcome === c.expect && direction === c.direction && review.usage.llmCalls === c.llmCalls,
        tokens: review.usage.inputTokens,
      });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
  return rows;
}
