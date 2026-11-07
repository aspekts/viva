import type { MemoryEntry } from "@viva/contracts";
import { looksLikeInjection } from "../pipeline/injection.js";
import { git } from "../sources/git.js";
import { MEMORY_DIR, memoryPath, parseMemory } from "./store.js";

/** Enough to question a change, without letting memory dominate the prompt. */
export const MAX_MEMORIES = 8;
const MAX_EXPLANATION_CHARS = 1200;

/** Memory files present at a commit, as one git call rather than one per changed file. */
async function memoryFilesAt(repoPath: string, ref: string): Promise<Set<string>> {
  try {
    return new Set((await git(repoPath, ["ls-tree", "-r", "-z", "--name-only", ref, "--", MEMORY_DIR])).split("\0"));
  } catch {
    return new Set();
  }
}

/**
 * Decisions recorded for the files a change touches. Plain git reads, no model,
 * so a push with no relevant memory costs nothing extra.
 *
 * Memory is read at the push's base commit only. It is an unsigned assertion in
 * the repo, not a verified statement, so memory the push itself adds or edits
 * never takes part in reviewing that push: a change can't rewrite the decision
 * it reverses, or flood out older entries, and only reaches later pushes once
 * it is part of their base. Entries that try to instruct the reviewer, or are
 * filed under another path, are dropped. Fails open: any error means no memory.
 */
export async function relevantMemory(repoPath: string, base: string, files: string[]): Promise<MemoryEntry[]> {
  const found = new Map<string, MemoryEntry>();
  const present = await memoryFilesAt(repoPath, base);
  for (const file of files) {
    const path = memoryPath(file);
    if (!path || !present.has(path)) continue;
    const text = await git(repoPath, ["show", `${base}:${path}`]).catch(() => "");
    for (const entry of parseMemory(text)) {
      const quoted = [entry.claim, entry.question, entry.explanation, ...entry.symbols].join("\n");
      if (entry.location.file === file && !looksLikeInjection(quoted) && !found.has(entry.id)) found.set(entry.id, entry);
    }
  }
  return [...found.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_MEMORIES);
}

/** What a check sees of each memory. Wrap it with untrusted(): it is a developer's words. */
export function memoryBrief(entries: MemoryEntry[]): string {
  return JSON.stringify(entries.map((e) => ({
    id: e.id,
    file: e.location.file,
    lines: e.location.lines,
    decision: e.claim,
    question: e.question,
    explanation: e.explanation.slice(0, MAX_EXPLANATION_CHARS),
    person: e.person,
    savedAt: e.at,
  })));
}
