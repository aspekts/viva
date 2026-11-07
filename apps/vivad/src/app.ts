import { fileURLToPath } from "node:url";
import { Answer, ReviewRequest, type Review } from "@viva/contracts";
import {
  appendAttestations,
  computeFog,
  entireSource,
  GeminiProvider,
  grepBlastRadius,
  loadChecks,
  loadFogFiles,
  MockProvider,
  readLedger,
  skipWithDebt,
  startReview,
  submitAnswers,
  type LlmProvider,
} from "@viva/engine";
import { Hono } from "hono";
import { z } from "zod";

export function createProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  if (env.VIVA_LLM === "gemini") {
    if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) throw new Error("set GEMINI_API_KEY and GEMINI_MODEL");
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL);
  }
  return new MockProvider();
}

const CHECKS_DIR = fileURLToPath(new URL("../../../checks", import.meta.url));

/**
 * The daemon only tracks reviews and serves the UI. Reviews stay on this
 * machine, and only attestations leave it, inside git notes.
 */
export function createApp(llm: LlmProvider = createProvider()) {
  const reviews = new Map<string, Review>();
  const app = new Hono();

  app.get("/v1/health", (c) => c.json({ ok: true, llm: llm.id }));

  app.post("/v1/reviews", async (c) => {
    const request = ReviewRequest.parse(await c.req.json());
    const review = await startReview(request, {
      llm,
      checks: await loadChecks(CHECKS_DIR),
      session: entireSource,
      blast: grepBlastRadius,
      ledger: await readLedger(request.repoPath),
    });
    reviews.set(review.id, review);
    return c.json(review);
  });

  app.get("/v1/reviews", (c) => c.json([...reviews.values()].reverse()));

  app.get("/v1/reviews/:id", (c) => {
    const review = reviews.get(c.req.param("id"));
    return review ? c.json(review) : c.json({ error: "not found" }, 404);
  });

  app.post("/v1/reviews/:id/answers", async (c) => {
    const current = reviews.get(c.req.param("id"));
    if (!current) return c.json({ error: "not found" }, 404);
    const answers = z.array(Answer).parse(await c.req.json());
    const { review, attestations } = await submitAnswers(current, answers, { llm });
    reviews.set(review.id, review);
    await appendAttestations(review.request.repoPath, review.request.head, attestations);
    return c.json(review);
  });

  app.post("/v1/reviews/:id/skip", (c) => {
    const current = reviews.get(c.req.param("id"));
    if (!current) return c.json({ error: "not found" }, 404);
    const review = skipWithDebt(current);
    reviews.set(review.id, review);
    return c.json(review);
  });

  app.get("/v1/fog", async (c) => {
    const repoPath = c.req.query("repo") ?? process.cwd();
    return c.json(computeFog(await loadFogFiles(repoPath), await readLedger(repoPath), new Date()));
  });

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: error.message }, 500);
  });

  return app;
}
