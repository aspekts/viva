import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Answer, MemoryEntry, Review } from "@viva/contracts";
import { defaults } from "../config.js";
import { readLedger } from "../ledger/notes.js";
import { MockProvider } from "../llm/mock.js";
import { parseCheck } from "../pipeline/checks.js";
import { runPrechecks } from "../pipeline/prechecks.js";
import { startReview, submitAnswers } from "../pipeline/review.js";
import { grepBlastRadius } from "../sources/graph.js";
import { fixtureRepo } from "../testing.js";
import { memoryFromReview, memoryPath, parseMemory, readMemory, renderEntry, saveMemory } from "./store.js";

const repos: string[] = [];
afterEach(() => { for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true }); });

const entry = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: "r1/q1",
  reviewId: "r1",
  questionId: "q1",
  location: { file: "src/pay.ts", lines: [2, 3] },
  symbols: ["pay"],
  claim: "Checks the card before charging",
  question: "What happens if the check runs after the charge?",
  explanation: "The check must come first.\n\nOtherwise a retry charges twice.",
  person: "Marcus",
  at: "2026-11-07T22:00:00.000Z",
  commit: "abc123",
  ...over,
});

/** A real passed exam against a fixture repo, using the offline mock provider. */
async function passedExam(answer = "The behaviour is deliberate: the check runs before the charge so a retry cannot charge twice.") {
  const { repo, base, head } = fixtureRepo(
    { "src/pay.ts": "export function pay(card) {\n  return send(card);\n}\n" },
    { "src/pay.ts": "export function pay(card) {\n  check(card);\n  return charge(card);\n}\n" },
  );
  repos.push(repo);
  const deps = {
    llm: new MockProvider(),
    checks: [parseCheck("---\nname: test-check\ndescription: d\n---\nFind things.")],
    session: { load: async () => null },
    blast: grepBlastRadius,
    ledger: [],
  };
  const started = await startReview({ repoPath: repo, base, head, person: "Marcus" }, deps);
  const answers: Answer[] = started.plan!.questions.map((q) => ({ questionId: q.id, transcript: answer, mode: "typed" }));
  const { review, attestations } = await submitAnswers(started, answers, deps);
  return { repo, review, answers, attestations };
}

describe("memory format", () => {
  it("reads back exactly what it writes, including awkward text", () => {
    const awkward = entry({ person: "a --> b", explanation: "Line one\r\n> quoted\n\n## not a heading" });
    const parsed = parseMemory(`# Viva memory: src/pay.ts\r\n\r\n${renderEntry(entry())}\n${renderEntry({ ...awkward, id: "r1/q2" })}`);
    expect(parsed).toEqual([entry(), { ...awkward, id: "r1/q2", explanation: "Line one\n> quoted\n\n## not a heading" }]);
  });

  it("skips damaged entries rather than failing", () => {
    const good = renderEntry(entry());
    const badJson = renderEntry(entry({ id: "r1/q2" })).replace("{\"id\"", "{id");
    const badShape = renderEntry(entry({ id: "r1/q3" })).replace("\"commit\":\"abc123\"", "\"commit\":7");
    expect(parseMemory(`${badJson}\n${good}\n${badShape}\nrandom ## text`).map((e) => e.id)).toEqual(["r1/q1"]);
    expect(parseMemory("")).toEqual([]);
  });

  it("maps a source file to one markdown file, and refuses unsafe paths", () => {
    expect(memoryPath("src/pay.ts")).toBe(".viva/memory/src/pay.ts.md");
    for (const bad of ["../x.ts", "src/../../x.ts", "/abs.ts", "a\\b.ts", "C:/x.ts", ".viva/config.json", "src//x.ts"]) {
      expect(memoryPath(bad)).toBeNull();
    }
  });
});

describe("saving memory", () => {
  it("keeps only the passed answers of a passed exam", async () => {
    const { review, answers } = await passedExam();
    expect(review.gate?.reason).toBe("exam-passed");
    expect(memoryFromReview(review, answers)).toHaveLength(1);
    const failed: Review = { ...review, gate: { verdict: "reject", reason: "exam-failed", skippable: true } };
    expect(memoryFromReview(failed, answers)).toEqual([]);
    const rejectedGrade: Review = { ...review, grades: review.grades.map((g) => ({ ...g, verdict: "reject" as const })) };
    expect(memoryFromReview(rejectedGrade, answers)).toEqual([]);
    expect(memoryFromReview(review, answers.map((a) => ({ ...a, transcript: "  " })))).toEqual([]);
  });

  it("writes markdown a later session can find, and saving twice adds nothing", async () => {
    const { repo, review, answers, attestations } = await passedExam();
    const saved = await saveMemory(review, answers);
    expect(saved.files).toEqual([".viva/memory/src/pay.ts.md"]);
    const text = readFileSync(join(repo, ".viva", "memory", "src", "pay.ts.md"), "utf8");
    expect(text).toContain("# Viva memory: src/pay.ts");
    expect(text).toContain("> The behaviour is deliberate");
    expect(await readMemory(repo, "src/pay.ts")).toEqual(saved.entries);

    expect((await saveMemory(review, answers)).entries).toEqual(saved.entries);
    expect(readFileSync(join(repo, ".viva", "memory", "src", "pay.ts.md"), "utf8")).toBe(text);

    // The ledger holds scores and hashes only: the reasoning never reaches it.
    expect(JSON.stringify(attestations)).not.toMatch(/deliberate|charge twice/);
    expect(JSON.stringify(await readLedger(repo))).not.toMatch(/deliberate|charge twice/);
  });

  it("only writes memory for files the review changed", async () => {
    const { repo, review, answers } = await passedExam();
    const elsewhere: Review = {
      ...review,
      plan: { questions: review.plan!.questions.map((q) => ({ ...q, location: { ...q.location, file: "../outside.ts" } })) },
    };
    expect(await saveMemory(elsewhere, answers)).toMatchObject({ files: [], entries: [] });
    expect(await readMemory(repo, "../outside.ts")).toEqual([]);
  });

  /**
   * Links a folder, or returns false where this machine doesn't allow it. A junction
   * needs no privilege on Windows; elsewhere the type is ignored.
   */
  const link = (target: string, path: string) => {
    try {
      symlinkSync(target, path, "junction");
      return true;
    } catch (error) {
      if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
      throw error;
    }
  };
  const noLinks = "this machine does not permit creating symlinks or junctions";

  it.for([
    { name: ".viva", link: [".viva"] },
    { name: ".viva/memory", link: [".viva", "memory"] },
    { name: "a nested memory folder", link: [".viva", "memory", "src"] },
  ])("refuses a symlinked $name before creating anything outside the repo", async ({ link: path }, ctx) => {
    const { repo, review, answers } = await passedExam();
    const outside = mkdtempSync(join(tmpdir(), "viva-outside-"));
    repos.push(outside);
    mkdirSync(join(repo, ...path.slice(0, -1)), { recursive: true });
    if (!link(outside, join(repo, ...path))) ctx.skip(noLinks);

    await expect(saveMemory(review, answers)).rejects.toThrow(/memory folder/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses a nested folder that is a file", async () => {
    const { repo, review, answers } = await passedExam();
    mkdirSync(join(repo, ".viva", "memory"), { recursive: true });
    writeFileSync(join(repo, ".viva", "memory", "src"), "not a folder");
    await expect(saveMemory(review, answers)).rejects.toThrow(/memory folder/);
    expect(existsSync(join(repo, ".viva", "memory", "src", "pay.ts.md"))).toBe(false);
  });

  it("reads missing memory as empty", async () => {
    const { repo } = await passedExam();
    expect(await readMemory(repo, "src/pay.ts")).toEqual([]);
    expect(await readMemory(join(repo, "gone"), "src/pay.ts")).toEqual([]);
  });

  it("is not Viva's config, so it neither trips nor bypasses the hard gate", () => {
    const change = (paths: string[]) => ({ diff: "", files: paths.map((path) => ({ path, added: 1, removed: 0 })), totalLines: paths.length });
    expect(runPrechecks(change([".viva/memory/src/pay.ts.md", "src/pay.ts"]), defaults)).toBeNull();
    expect(runPrechecks(change([".viva/memory/src/pay.ts.md", ".viva/config.json"]), defaults)?.reason).toBe("viva-config-changed");
    expect(runPrechecks(change([".viva/memory/x.md", ".viva/checks/x.md"]), defaults)?.skippable).toBe(false);
  });
});
