import { afterEach, describe, expect, it, vi } from "vitest";
import type { Claim } from "@viva/contracts";
import { GeminiProvider, loadChecks, type LlmProvider } from "@viva/engine";
import { fileURLToPath } from "node:url";
import { cases, checkNames, holdoutIds, realIds, type EvalCase } from "./cases/index.js";
import { runExamEval, summarizeExam } from "./exam.js";
import { gradeClaims, hash, matchesClaim, report, runMatrix, safeError, summarize } from "./matrix.js";
import { main, RATE_LIMITED_EXIT } from "./run.js";

const bug = cases[0]!;
const clean = cases.find((c) => c.id === "13-clean-guard")!;
const finding: Claim = {
  id: "test-1", check: "behaviour-change", summary: "The strict boundary skips the final full page.",
  evidence: "The loop now excludes equality.", origin: "silent", symbols: ["pages"],
  location: { file: "src/pages.ts", lines: [3, 3] },
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("fixed claim grading", () => {
  const asked = cases.find((c) => c.id === "18-requested-default")!;
  const mixed = cases.find((c) => c.id === "22-mixed-upload-limit")!;
  const onRequest: Claim = { ...finding, summary: "Caching is on by default", evidence: "fetch default", location: { file: "config/cache.rb", lines: [2, 2] } };

  it("reuses a seeded diff under an intent that asks for it", () => {
    const source = cases.find((c) => c.id === "05-changed-default")!;
    expect(asked.after).toEqual(source.after);
    expect(asked.intent).not.toBe(source.intent);
  });
  it("accepts silence or a requested label on requested work, and nothing else", () => {
    expect(gradeClaims(asked, "silent-decision", [])).toBe("CLEAR");
    expect(gradeClaims(asked, "behaviour-change", [{ ...onRequest, origin: "requested" }])).toBe("CLEAR");
    expect(gradeClaims(asked, "silent-decision", [onRequest])).toBe("MISLABEL");
    expect(gradeClaims(asked, "behaviour-change", [{ ...onRequest, origin: "inferred" }])).toBe("MISLABEL");
    expect(gradeClaims(asked, "failure-path", [{ ...onRequest, location: { file: "config/other.rb", lines: [9, 9] } }])).toBe("FP");
  });
  it("needs the silent change found without mislabelling the requested one in a mixed diff", () => {
    const silent: Claim = {
      ...finding, summary: "The upload size limit increases to 100 MB", evidence: "MAX_UPLOAD_BYTES",
      location: { file: "api/upload.ts", lines: [3, 3] },
    };
    const limiter: Claim = { ...finding, summary: "Adds a rate limit", evidence: "limiter", location: { file: "api/upload.ts", lines: [6, 6] } };
    expect(gradeClaims(mixed, "silent-decision", [silent])).toBe("HIT");
    expect(gradeClaims(mixed, "silent-decision", [silent, { ...limiter, origin: "requested" }])).toBe("HIT");
    expect(gradeClaims(mixed, "silent-decision", [silent, limiter])).toBe("MISLABEL");
    expect(gradeClaims(mixed, "silent-decision", [{ ...limiter, origin: "requested" }])).toBe("MISS");
  });
  it("keeps a fixed holdout of existing cases across every kind", () => {
    const held = cases.filter((c) => holdoutIds.includes(c.id));
    expect(held).toHaveLength(holdoutIds.length);
    expect(held.some((c) => c.expected)).toBe(true);
    expect(held.some((c) => !c.expected && c.requested)).toBe(true);
    expect(held.some((c) => !c.expected && !c.requested)).toBe(true);
  });

  it("keeps the real agent changes out of tune and holdout, and each one a real diff", () => {
    const real = cases.filter((c) => realIds.includes(c.id));
    expect(real).toHaveLength(10);
    expect(real.filter((c) => c.expected)).toHaveLength(6);
    expect(real.some((c) => holdoutIds.includes(c.id))).toBe(false);
    for (const c of real) {
      expect(Object.keys(c.after).length).toBeGreaterThan(0);
      expect(JSON.stringify(c.before)).not.toBe(JSON.stringify(c.after));
      if (c.expected) expect(c.after[c.expected.file]).toBeDefined();
    }
  });

  it("requires the actual seeded claim, not just an exam or unrelated finding", () => {
    expect(gradeClaims(bug, "behaviour-change", [finding])).toBe("HIT");
    expect(gradeClaims(bug, "behaviour-change", [{ ...finding, summary: "Renames the accumulator", evidence: "Renamed local" }])).toBe("MISS");
    expect(gradeClaims(bug, "behaviour-change", [])).toBe("MISS");
  });
  it("requires the same claim to match every concept and the fixed location", () => {
    expect(matchesClaim(bug.expected!, { ...finding, location: { file: "other.ts", lines: [3, 3] } }, "behaviour-change")).toBe(false);
    expect(matchesClaim(bug.expected!, { ...finding, location: { file: "src/pages.ts", lines: [6, 6] } }, "behaviour-change")).toBe(false);
    const split = [
      { ...finding, summary: "The final page", evidence: "boundary" },
      { ...finding, summary: "Skips something", evidence: "boundary" },
    ];
    expect(gradeClaims(bug, "behaviour-change", split)).toBe("MISS");
    expect(gradeClaims(bug, "silent-decision", [{ ...finding, origin: "requested" }])).toBe("MISS");
  });
  it("counts any claim on clean code as a false positive and separates off-scope claims", () => {
    expect(gradeClaims(clean, "behaviour-change", [])).toBe("CLEAR");
    expect(gradeClaims(clean, "failure-path", [finding])).toBe("FP");
    expect(gradeClaims(bug, "failure-path", [finding])).toBe("EXTRA");
  });
  it("covers all bug categories, four model-tested clean refactors, and docs", () => {
    expect(cases.filter((c) => c.expected)).toHaveLength(16 + 6);
    expect(cases.filter((c) => !c.expected && !c.gate && !c.requested)).toHaveLength(7 + 4);
    expect(cases.filter((c) => !c.expected && c.requested)).toHaveLength(4);
    expect(cases.filter((c) => c.gate)).toHaveLength(1);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases.filter((c) => c.expected)) {
      expect(c.expected!.lines[1]).toBeLessThanOrEqual(c.after[c.expected!.file]!.trimEnd().split("\n").length);
    }
    expect(hash(/first/)).not.toBe(hash(/second/));
  });
});

const docsOnly = cases.find((c) => c.gate === "docs-only")!;

const checks = () => loadChecks(fileURLToPath(new URL("../checks", import.meta.url)));

describe("matrix runner", () => {
  it("runs real check prompts sequentially, counts tokens, and never sends the rubric", async () => {
    let active = 0;
    let calls = 0;
    const provider: LlmProvider = {
      id: "scripted-test",
      async complete(request) {
        active += 1;
        expect(active).toBe(1);
        expect(request.user).toContain('<untrusted name="diff">');
        expect(request.user).not.toContain(bug.expected!.description);
        expect(request.system).toContain("Return JSON matching the schema");
        await new Promise<void>((resolve) => setImmediate(resolve));
        calls += 1;
        active -= 1;
        const claims = request.name === "check:failure-path" ? [] : [finding];
        return { value: request.schema.parse({ claims }), inputTokens: 10, outputTokens: 5 };
      },
    };
    const matrix = await runMatrix([bug], await checks(), provider, "test-model");
    expect(calls).toBe(3);
    expect(matrix.rows[0]!.cells.map((c) => c.status)).toEqual(["HIT", "CLEAR", "HIT"]);
    expect(summarize(matrix, [bug])).toMatchObject({ recall: "1/1 (100.0%)", inputTokens: 30, outputTokens: 15, complete: true });
    expect(report(matrix, [bug])).not.toContain(finding.evidence);
  });
  it("runs deterministic hard gates/docs first without invoking a model", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("must not call"));
    const protectedCase: EvalCase = {
      id: "protected", intent: "update config", expected: null,
      before: { ".viva/config.json": "{}\n" }, after: { ".viva/config.json": '{"riskThreshold":99}\n' },
    };
    const matrix = await runMatrix([docsOnly, protectedCase], await checks(), { id: "test", complete }, "test");
    expect(complete).not.toHaveBeenCalled();
    expect(matrix.rows.map((r) => r.gate)).toEqual(["docs-only", "viva-config-changed"]);
    expect(matrix.rows[0]!.cells.every((c) => c.status === "GATE")).toBe(true);
    expect(summarize(matrix, [docsOnly, protectedCase]).complete).toBe(false);
  });
  it("stops every remaining cell on 429 and does not miscount unmeasured clean cases", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("Gemini returned 429: PRIVATE BODY"));
    const matrix = await runMatrix([bug, clean], await checks(), { id: "test", complete }, "test");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(matrix.stopped).toBe(true);
    expect(matrix.rows[0]!.cells.map((c) => c.status)).toEqual(["ERROR", "NOT-RUN", "NOT-RUN"]);
    expect(matrix.rows[1]!.cells.every((c) => c.status === "NOT-RUN")).toBe(true);
    expect(summarize(matrix, [bug, clean])).toMatchObject({ recall: "0/1 (0.0%)", falsePositiveRate: "n/a (0 observations)", complete: false });
    expect(report(matrix, [bug, clean])).not.toContain("PRIVATE BODY");
    expect(report(matrix, [bug, clean])).toContain("NOT-RUN");
  });
  it("scores clean false positives separately from recall", async () => {
    const provider: LlmProvider = {
      id: "test", async complete(request) {
        return { value: request.schema.parse({ claims: [finding] }), inputTokens: 1, outputTokens: 1 };
      },
    };
    const matrix = await runMatrix([bug, clean, docsOnly], await checks(), provider, "test");
    expect(summarize(matrix, [bug, clean, docsOnly])).toMatchObject({ recall: "1/1 (100.0%)", falsePositiveRate: "1/1 (100.0%)" });
    expect(checkNames).toHaveLength(3);
  });
});

describe("eval pacing and reporting", () => {
  it("waits between model calls, outside the latency it reports", async () => {
    const started: number[] = [];
    const provider: LlmProvider = {
      id: "paced-test", async complete(request) {
        started.push(performance.now());
        return { value: request.schema.parse({ claims: [] }), inputTokens: 1, outputTokens: 1 };
      },
    };
    const matrix = await runMatrix([clean], await checks(), provider, "test", undefined, 25);
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(20);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(20);
    expect(matrix.rows[0]!.cells.every((c) => c.latencyMs < 20)).toBe(true);
  });
  it("reports tune and holdout scores separately, and requested handling", async () => {
    const provider: LlmProvider = {
      id: "test", async complete(request) {
        return { value: request.schema.parse({ claims: [] }), inputTokens: 1, outputTokens: 1 };
      },
    };
    const selection = cases.filter((c) => ["18-requested-default", "20-requested-timeout"].includes(c.id));
    const matrix = await runMatrix(selection, await checks(), provider, "test");
    expect(summarize(matrix, selection).requestedCorrect).toBe("2/2 (100.0%)");
    expect(report(matrix, selection)).toMatch(/\| tune \|[\s\S]*\| holdout \|/);
  });
});

describe("exam eval", () => {
  const seeded = { ...finding, summary: "The strict boundary skips the final full page." };
  const scripted = (claims: Claim[], wrongPasses = false): LlmProvider => ({
    id: "test",
    async complete(request) {
      if (request.name.startsWith("check:")) return { value: request.schema.parse({ claims }), inputTokens: 1, outputTokens: 1 };
      if (request.name === "plan") {
        const claimId = /"id":"([^"]+)"/.exec(request.user)![1];
        const question = { id: "q1", claimId, ask: "What happens to the last batch?", mustMention: ["it is dropped"], followUpIfVague: "Try an exact multiple.", location: finding.location };
        return { value: request.schema.parse({ questions: [question] }), inputTokens: 1, outputTokens: 1 };
      }
      const pass = wrongPasses || !/Nothing really changes|logs a warning/.test(request.user);
      const grade = { questionId: "q1", verdict: pass ? "approve" : "reject", score: pass ? 1 : 0, missing: [] };
      return { value: request.schema.parse({ grades: [grade] }), inputTokens: 1, outputTokens: 1 };
    },
  });

  it("grades a right and a wrong answer on the seeded question, without its text in the row", async () => {
    const rows = await runExamEval([bug], await checks(), scripted([seeded]));
    expect(rows[0]).toMatchObject({ outcome: "exam", onTarget: true, right: "approve", wrong: "reject", problems: [] });
    expect(summarizeExam(rows, [bug])).toMatchObject({ onTarget: "1/1", rightAnswersPass: "1/1", wrongAnswersFail: "1/1" });
    expect(JSON.stringify(rows)).not.toContain("last batch");
  });
  it("counts a rubric that passes the wrong answer", async () => {
    const rows = await runExamEval([bug], await checks(), scripted([seeded], true));
    expect(summarizeExam(rows, [bug]).wrongAnswersFail).toBe("0/1");
  });
  it("skips grading when the exam is about something else, and counts clean interruptions", async () => {
    const rows = await runExamEval([bug, clean], await checks(), scripted([{ ...seeded, summary: "Renames a local", evidence: "name" }]));
    expect(rows[0]).toMatchObject({ onTarget: false });
    expect(rows[0]!.right).toBeUndefined();
    expect(summarizeExam(rows, [bug, clean])).toMatchObject({ onTarget: "0/1", interruptedOnCleanOrRequested: "1/1" });
  });
});

describe("live opt-in", () => {
  it("skips without a key before any API access", async () => {
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--live"])).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("SKIP live evals"));
  });
  it.each([[["--live", "--split", "holdout"]], [["--live", "--exam", "--split", "holdout"]]])("exits distinctly and says so on a 429: %j", async (args) => {
    vi.spyOn(process, "loadEnvFile").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private response body", { status: 429 })));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(args)).toBe(RATE_LIMITED_EXIT);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("STOPPED: HTTP 429"));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("private response body"));
  });
  it("Gemini does not retry a shared-key 429 in eval mode", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("private response body", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const provider = new GeminiProvider("test-key", "test-model", undefined, 0, false);
    const check = (await checks())[0]!;
    const matrix = await runMatrix([bug], [check, ...(await checks()).slice(1)], provider, "test-model");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(matrix.rows[0]!.cells[0]!.error).toBe("Gemini returned 429");
    expect(safeError(new Error("private data"))).toBe("provider-or-harness-error");
    expect(report(matrix, [bug])).not.toContain("private response body");
  });
});
