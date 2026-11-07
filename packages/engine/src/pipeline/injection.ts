import type { Gate } from "@viva/contracts";

const PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts)/i,
  /disregard (the |your )?(system|previous) (prompt|instructions)/i,
  /you are now\b/i,
  /<\/?untrusted/i,
  /\b(viva|reviewer|grader|examiner)\b.{0,40}\b(approve|pass|skip|mark)\b/i,
];

/** Scans added lines only. A match defers to a human and cannot be skipped. */
export function scanForInjection(diff: string): Gate | null {
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
  return PATTERNS.some((p) => p.test(added))
    ? { verdict: "defer", reason: "injection-suspected", skippable: false }
    : null;
}
