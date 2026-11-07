import { fileURLToPath } from "node:url";
import { Answer, FogMap, ReviewCode, ReviewFeedback, ReviewRequest, VivaEvent, type Review } from "@viva/contracts";
import {
  appendAttestations,
  codeWindow,
  computeFog,
  entireSource,
  fogVersion,
  GeminiProvider,
  grepBlastRadius,
  loadChecks,
  loadFogFiles,
  MockProvider,
  readLedger,
  readReviewFile,
  skipWithDebt,
  startReview,
  submitAnswers,
  type LlmProvider,
} from "@viva/engine";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { decisionIdentity, readDecision, writeDecision } from "./decisions.js";

export function createProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  if (env.VIVA_LLM === "gemini") {
    if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) throw new Error("set GEMINI_API_KEY and GEMINI_MODEL");
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL);
  }
  return new MockProvider();
}

const CHECKS_DIR = fileURLToPath(new URL("../../../checks", import.meta.url));

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const CodeQuery = z.object({
  file: z.string().min(1),
  start: z.coerce.number().int().positive(),
  end: z.coerce.number().int().positive(),
}).refine(({ start, end }) => start <= end);

/**
 * The daemon only tracks reviews and serves the UI. Reviews stay on this
 * machine, and only attestations leave it, inside git notes.
 */
export function createApp(llm: LlmProvider = createProvider(), { fogPollMs = 2000 } = {}) {
  const reviews = new Map<string, Review>();
  const byKey = new Map<string, Promise<Review>>();
  const changing = new Set<string>();
  const app = new Hono();

  const listeners = new Set<(event: VivaEvent) => void>();
  const publish = (event: VivaEvent) => { for (const listener of listeners) listener(event); };
  /** The last fog version seen for each repo that has been reviewed. */
  const fogVersions = new Map<string, string>();
  /** The repo the Fog maps by default: the one most recently pushed. Forgotten on restart. */
  let latestRepo: string | null = null;
  let fogPoll: NodeJS.Timeout | undefined;
  let checkingFog = false;

  async function checkFog(repoPath: string) {
    const version = await fogVersion(repoPath).catch(() => null);
    if (version === null || fogVersions.get(repoPath) === version) return;
    fogVersions.set(repoPath, version);
    publish({ type: "fog", repoPath });
  }

  async function record(review: Review) {
    reviews.set(review.id, review);
    publish({ type: "review", reviewId: review.id, stage: review.stage, gate: review.gate });
    await checkFog(review.request.repoPath);
  }

  app.get("/v1/health", (c) => c.json({ ok: true, llm: llm.id }));

  app.post("/v1/reviews", async (c) => {
    const { request, key, dir } = await decisionIdentity(ReviewRequest.parse(await c.req.json()));
    let pending = byKey.get(key);
    if (!pending) {
      pending = (async () => {
        const receipt = await readDecision(dir, key);
        const review: Review = receipt ? {
          id: receipt.reviewId, request, stage: "done", claims: [], plan: null, grades: [],
          gate: receipt.gate, usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
          startedAt: receipt.finishedAt, finishedAt: receipt.finishedAt,
        } : await startReview(request, {
          llm,
          checks: await loadChecks(CHECKS_DIR),
          session: entireSource,
          blast: grepBlastRadius,
          ledger: await readLedger(request.repoPath),
        });
        if (!receipt) await writeDecision(review);
        await record(review);
        return review;
      })();
      byKey.set(key, pending);
      // Allow a retry after an infrastructure failure.
      pending.catch(() => byKey.delete(key));
    }
    const initial = await pending;
    const review = reviews.get(initial.id) ?? initial;
    latestRepo = review.request.repoPath;
    return c.json(review);
  });

  app.get("/v1/reviews", (c) => c.json([...reviews.values()].reverse()));

  app.get("/v1/reviews/:id", (c) => {
    const review = reviews.get(c.req.param("id"));
    return review ? c.json(review) : c.json({ error: "review not found; retry git push to refresh it after a daemon restart" }, 404);
  });

  app.post("/v1/reviews/:id/answers", async (c) => {
    const answers = z.array(Answer).parse(await c.req.json());
    const current = reviews.get(c.req.param("id"));
    if (!current) return c.json({ error: "not found" }, 404);
    if (current.stage !== "awaiting-exam" || changing.has(current.id)) {
      return c.json({ error: "review is not awaiting an exam" }, 409);
    }
    changing.add(current.id);
    try {
      const { review, attestations } = await submitAnswers(current, answers, { llm });
      await appendAttestations(review.request.repoPath, review.request.head, attestations);
      await writeDecision(review);
      await record(review);
      return c.json(review);
    } finally {
      changing.delete(current.id);
    }
  });

  app.post("/v1/reviews/:id/skip", async (c) => {
    const current = reviews.get(c.req.param("id"));
    if (!current) return c.json({ error: "not found" }, 404);
    if (current.gate?.skippable === false || changing.has(current.id)) {
      return c.json({ error: "this gate cannot be skipped" }, 409);
    }
    const review = skipWithDebt(current);
    changing.add(current.id);
    try {
      await writeDecision(review);
      await record(review);
      return c.json(review);
    } finally {
      changing.delete(current.id);
    }
  });

  app.get("/v1/reviews/:id/feedback", (c) => {
    const review = reviews.get(c.req.param("id"));
    if (!review) return c.json({ error: "review not found; retry git push after a daemon restart" }, 404);
    if (!review.gate) return c.json({ error: "complete the exam first" }, 409);
    if (review.gate.reason.startsWith("exam-") && review.grades.length === 0) {
      return c.json({ error: "feedback expired on daemon restart; only the gate decision was retained" }, 410);
    }
    return c.json(ReviewFeedback.parse({
      reviewId: review.id, gate: review.gate,
      items: review.grades.flatMap((grade) => {
        const question = review.plan?.questions.find((q) => q.id === grade.questionId);
        return question && grade.missing.length ? [{
          questionId: question.id, location: question.location, ask: question.ask, missing: grade.missing,
        }] : [];
      }),
    }));
  });

  app.get("/v1/reviews/:id/code", async (c) => {
    // A page that rebinds its DNS to this port must not be able to read source.
    if (!LOOPBACK_HOSTS.has(new URL(c.req.url).hostname)) return c.json({ error: "local requests only" }, 403);
    const review = reviews.get(c.req.param("id"));
    if (!review) return c.json({ error: "review not found; retry git push to refresh it after a daemon restart" }, 404);
    const query = CodeQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: "expected file, start and end" }, 400);
    const { file, start, end } = query.data;
    const { repoPath, base, head } = review.request;
    const source = await readReviewFile(repoPath, base, head, file).catch(() => null);
    if (!source) return c.json({ error: "this review's commits are no longer available" }, 410);
    if ("refused" in source) {
      return source.refused === "not-in-review"
        ? c.json({ error: "file is not in this review at its head commit" }, 404)
        : c.json({ error: `file cannot be shown: ${source.refused}` }, 422);
    }
    const window = codeWindow(source.text, start, end);
    if (!window) return c.json({ error: "lines are outside this file" }, 422);
    c.header("cache-control", "no-store");
    return c.json(ReviewCode.parse({ reviewId: review.id, file, commit: head, ...window }));
  });

  /** Only runs while someone is listening. Commits change the fog without any review. */
  app.get("/v1/events", (c) => streamSSE(c, async (stream) => {
    const listener = (event: VivaEvent) => { void stream.writeSSE({ data: JSON.stringify(VivaEvent.parse(event)) }); };
    listeners.add(listener);
    fogPoll ??= setInterval(async () => {
      // Slow git, as on Windows, must not pile up processes from earlier checks.
      if (checkingFog) return;
      checkingFog = true;
      await Promise.all([...fogVersions.keys()].map(checkFog));
      checkingFog = false;
    }, fogPollMs).unref();
    // Sends the headers now, so the browser knows the stream is open.
    await stream.write(": connected\n\n");
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(fogPoll);
      fogPoll = undefined;
    }
  }));

  app.get("/v1/fog", async (c) => {
    const fog = async (repoPath: string) => FogMap.parse({
      repoPath, ...computeFog(await loadFogFiles(repoPath), await readLedger(repoPath), new Date()),
    });
    const requested = c.req.query("repo");
    if (requested) return c.json(await fog(requested));
    const remembered = latestRepo;
    const map = remembered ? await fog(remembered).catch(() => null) : null;
    // A repo that has since moved or gone is forgotten, rather than failing every request.
    if (remembered && !map && latestRepo === remembered) latestRepo = null;
    return c.json(map ?? FogMap.parse({ repoPath: null, generatedAt: new Date().toISOString(), debt: 0, nodes: [] }));
  });

  app.onError((error, c) => {
    // Errors from a provider may contain model/repository text. Never log it.
    console.error("vivad: request failed");
    return c.json({ error: "Viva request failed" }, 500);
  });

  return app;
}
