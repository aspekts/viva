import { afterEach, describe, expect, it, vi } from "vitest";
import type { Claim } from "@viva/contracts";
import { GeminiProvider, loadChecks, type LlmProvider } from "@viva/engine";
import { fileURLToPath } from "node:url";
import { cases, checkNames, type EvalCase } from "./cases/index.js";
import { gradeClaims, hash, matchesClaim, report, runMatrix, safeError, summarize } from "./matrix.js";
import { main } from "./run.js";

const bug = cases[0]!;
const clean = cases.find((c) => c.id === "13-clean-guard")!;
const finding: Claim = {
  id: "test-1", check: "behaviour-change", summary: "The strict boundary skips the final full page.",
  evidence: "The loop now excludes equality.", origin: "silent", symbols: ["pages"],
  location: { file: "src/pages.ts", lines: [3, 3] },
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("fixed claim grading", () => {
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
    expect(cases.filter((c) => c.expected)).toHaveLength(12);
    expect(cases.filter((c) => !c.expected && !c.gate)).toHaveLength(4);
    expect(cases.filter((c) => c.gate)).toHaveLength(1);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases.filter((c) => c.expected)) {
      expect(c.expected!.lines[1]).toBeLessThanOrEqual(c.after[c.expected!.file]!.trimEnd().split("\n").length);
    }
    expect(hash(/first/)).not.toBe(hash(/second/));
  });
});

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
    const matrix = await runMatrix([cases.at(-1)!, protectedCase], await checks(), { id: "test", complete }, "test");
    expect(complete).not.toHaveBeenCalled();
    expect(matrix.rows.map((r) => r.gate)).toEqual(["docs-only", "viva-config-changed"]);
    expect(matrix.rows[0]!.cells.every((c) => c.status === "GATE")).toBe(true);
    expect(summarize(matrix, [cases.at(-1)!, protectedCase]).complete).toBe(false);
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
    const matrix = await runMatrix([bug, clean, cases.at(-1)!], await checks(), provider, "test");
    expect(summarize(matrix, [bug, clean, cases.at(-1)!])).toMatchObject({ recall: "1/1 (100.0%)", falsePositiveRate: "1/1 (100.0%)" });
    expect(checkNames).toHaveLength(3);
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
