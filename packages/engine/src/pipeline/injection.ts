import type { Gate } from "@viva/contracts";

const PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the |your )?(system|previous) (prompt|instructions)/i,
  /you are now\b/i,
  /<\/?untrusted/i,
  /\b(viva|reviewer|grader|examiner)\b.{0,40}\b(approve|pass|skip|mark)\b/i,
];

/** True for text that tries to instruct a reviewer. Used on anything a prompt will quote. */
export function looksLikeInjection(text: string): boolean {
  return PATTERNS.some((p) => p.test(text));
}

/** Scans added lines only. A match defers to a human and cannot be skipped. */
export function scanForInjection(diff: string): Gate | null {
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
  return looksLikeInjection(added)
    ? { verdict: "defer", reason: "injection-suspected", skippable: false }
    : null;
}
