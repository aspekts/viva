import type { Gate } from "@viva/contracts";
import { PROTECTED_PATHS, type VivaConfig } from "../config.js";
import type { Change } from "../sources/git.js";

const DOCS = /\.(md|mdx|txt|rst)$|^(docs|LICENSE)/i;
const GENERATED = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/;

/** Runs before any model call, so a large share of pushes cost no tokens. */
export function runPrechecks(change: Change, config: VivaConfig): Gate | null {
  if (change.files.some((f) => PROTECTED_PATHS.some((p) => p.test(f.path)))) {
    return { verdict: "defer", reason: "viva-config-changed", skippable: false };
  }
  if (change.totalLines > config.maxChangedLines) {
    return { verdict: "defer", reason: "too-large", skippable: true };
  }
  if (change.files.every((f) => DOCS.test(f.path) || GENERATED.test(f.path))) {
    return { verdict: "endorse", reason: "docs-only", skippable: true };
  }
  return null;
}
