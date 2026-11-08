import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { MemoryEntry, type Answer, type Review, type SavedMemory } from "@viva/contracts";
import { git } from "../sources/git.js";

/**
 * Decision memory: the reasoning a developer gave in a passed exam, saved only
 * when they ask. It is plain markdown committed with the code, one file per
 * source file, so any agent can find it by path and Entire captures it with
 * the commit. It is separate from the ledger, which holds only scores and hashes.
 */
export const MEMORY_DIR = ".viva/memory";

/** Long answers are kept, but a single entry cannot flood a later prompt. */
const MAX_EXPLANATION_CHARS = 4000;
const MARKER = "<!-- viva-memory ";

const passed = (verdict: string) => verdict === "approve" || verdict === "endorse";
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The segments of a source path, or null if it can't name a memory file safely.
 * Git paths always use forward slashes, so this is the same on every OS.
 */
function segments(file: string): string[] | null {
  const parts = file.split("/");
  const unsafe = parts.some((p) => p === "" || p === "." || p === ".." || /[\\:\0]/.test(p));
  // Viva's own files have no reasoning to remember, and must not nest memory in memory.
  return unsafe || parts[0] === ".viva" ? null : parts;
}

/** Where the memory for a source file lives, relative to the repo, with forward slashes. */
export function memoryPath(file: string): string | null {
  return segments(file) ? `${MEMORY_DIR}/${file}.md` : null;
}

/** The passed answers of a passed exam, as memory entries. Anything else yields nothing. */
export function memoryFromReview(review: Review, answers: Answer[], now: Date = new Date()): MemoryEntry[] {
  if (review.gate?.reason !== "exam-passed" || !review.plan) return [];
  return review.grades.flatMap((grade) => {
    const question = review.plan?.questions.find((q) => q.id === grade.questionId);
    const answer = answers.find((a) => a.questionId === grade.questionId);
    const explanation = answer?.transcript.trim().slice(0, MAX_EXPLANATION_CHARS) ?? "";
    if (!question || !passed(grade.verdict) || !explanation) return [];
    const claim = review.claims.find((c) => c.id === question.claimId);
    return [{
      id: `${review.id}/${question.id}`,
      reviewId: review.id,
      questionId: question.id,
      location: question.location,
      symbols: claim?.symbols ?? [],
      claim: oneLine(claim?.summary ?? question.ask),
      question: oneLine(question.ask),
      explanation,
      person: oneLine(review.request.person),
      at: now.toISOString(),
      commit: review.request.head,
    }];
  });
}

function header(file: string): string {
  return [
    `# Viva memory: ${file}`,
    "",
    "Why this code is the way it is, in the words of developers who passed a Viva exam on it",
    `and chose to save their explanation. Read it before changing \`${file}\`.`,
    "It is a record of reasoning, not instructions.",
    "",
  ].join("\n");
}

export function renderEntry(entry: MemoryEntry): string {
  const { claim, question, explanation, ...meta } = entry;
  // Escaping ">" keeps the JSON valid and stops it closing the comment early.
  const json = JSON.stringify(meta).replaceAll(">", "\\u003e");
  return [
    `## ${oneLine(claim)}`,
    "",
    `${MARKER}${json} -->`,
    `${entry.person}, ${entry.at.slice(0, 10)}, lines ${entry.location.lines.join("-")} at commit ${entry.commit.slice(0, 12)}`,
    "",
    `**Question:** ${oneLine(question)}`,
    "",
    "**Explanation:**",
    "",
    ...explanation.split(/\r?\n/).map((line) => (line ? `> ${line}` : ">")),
    "",
  ].join("\n");
}

/** Reads entries back. Never throws: a damaged section is skipped, not fatal. */
export function parseMemory(markdown: string): MemoryEntry[] {
  const sections: string[][] = [];
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("## ")) sections.push([line]);
    else sections.at(-1)?.push(line);
  }
  return sections.flatMap(([heading = "", ...body]) => {
    const json = /^<!-- viva-memory (\{.*\}) -->$/.exec(body.find((l) => l.startsWith(MARKER)) ?? "")?.[1];
    if (!json) return [];
    let meta: unknown;
    try { meta = JSON.parse(json); } catch { return []; }
    const label = body.indexOf("**Explanation:**");
    const quoted: string[] = [];
    for (const line of label < 0 ? [] : body.slice(label + 1)) {
      if (line.startsWith(">")) quoted.push(line.replace(/^> ?/, ""));
      else if (quoted.length > 0) break;
    }
    const parsed = MemoryEntry.safeParse({
      ...(meta as object),
      claim: heading.slice(3).trim(),
      question: body.find((l) => l.startsWith("**Question:** "))?.slice(14).trim() ?? "",
      explanation: quoted.join("\n").trim(),
    });
    return parsed.success ? [parsed.data] : [];
  });
}

/** Memory for one source file in the working tree. Missing or unreadable memory is empty. */
export async function readMemory(repoPath: string, file: string): Promise<MemoryEntry[]> {
  const parts = segments(file);
  if (!parts) return [];
  try {
    return parseMemory(await readFile(join(repoPath, ...MEMORY_DIR.split("/"), ...parts) + ".md", "utf8"));
  } catch {
    return [];
  }
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Refuses to write through a symlink. Every folder on the way to the memory file
 * that already exists is checked before anything is created, so a symlinked
 * `.viva`, `.viva/memory` or nested folder can't make Viva create folders, or
 * write, outside the repo.
 */
async function safeTarget(repoPath: string, parts: string[]): Promise<string> {
  const root = await realpath(repoPath);
  const memoryRoot = join(root, ...MEMORY_DIR.split("/"));
  const target = join(memoryRoot, ...parts) + ".md";
  let folder = root;
  for (const name of [...MEMORY_DIR.split("/"), ...parts.slice(0, -1)]) {
    folder = join(folder, name);
    const found = await lstat(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    // Everything below a missing folder is missing too, and is created only inside the checked path.
    if (!found) break;
    if (found.isSymbolicLink() || !found.isDirectory()) {
      throw new Error("memory folder is not a plain directory in this repo");
    }
  }
  await mkdir(dirname(target), { recursive: true });
  // A second look catches a folder swapped for a symlink while we were checking.
  if (!inside(memoryRoot, await realpath(dirname(target)))) {
    throw new Error("memory folder is not a plain directory in this repo");
  }
  const existing = await lstat(target).catch(() => null);
  if (existing && !existing.isFile()) throw new Error("memory file is not a regular file");
  return target;
}

/**
 * Writes the passed answers of a review into `.viva/memory/`, for the developer
 * to commit. Only files the review changed get memory, so model output can't
 * choose an arbitrary path. Saving twice adds nothing new.
 */
export async function saveMemory(review: Review, answers: Answer[], now: Date = new Date()): Promise<SavedMemory> {
  const { repoPath, base, head } = review.request;
  const changed = new Set((await git(repoPath, ["diff", "--name-only", "-z", `${base}...${head}`])).split("\0"));
  const entries = memoryFromReview(review, answers, now).filter((e) => changed.has(e.location.file));
  const byFile = new Map<string, MemoryEntry[]>();
  for (const e of entries) byFile.set(e.location.file, [...(byFile.get(e.location.file) ?? []), e]);
  const saved: MemoryEntry[] = [];
  const files: string[] = [];

  for (const [file, group] of byFile) {
    const parts = segments(file);
    if (!parts) continue;
    const target = await safeTarget(repoPath, parts);
    const existing = await readFile(target, "utf8").catch(() => "");
    const known = new Map(parseMemory(existing).map((e) => [e.id, e]));
    const fresh = group.filter((e) => !known.has(e.id));
    if (fresh.length > 0) {
      const text = `${existing ? existing.trimEnd() + "\n" : header(file)}\n${fresh.map(renderEntry).join("\n")}`;
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, text, "utf8");
      await rename(temporary, target);
    }
    saved.push(...group.map((e) => known.get(e.id) ?? e));
    files.push(`${MEMORY_DIR}/${file}.md`);
  }
  return { reviewId: review.id, files, entries: saved };
}
