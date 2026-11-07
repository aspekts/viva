import type { Attestation } from "@viva/contracts";
import type { VivaConfig } from "../config.js";

const DAY_MS = 86_400_000;

/** Understanding fades with time, and halves when the code has changed since. */
export function decayedMastery(a: Attestation, currentHash: string | null, now: Date, config: VivaConfig): number {
  const days = Math.max(0, (now.getTime() - new Date(a.at).getTime()) / DAY_MS);
  const age = 0.5 ** (days / config.masteryHalfLifeDays);
  const unchanged = currentHash === null || currentHash === a.codeHash ? 1 : 0.5;
  return a.score * age * unchanged;
}

export function masteryFor(
  ledger: Attestation[],
  person: string,
  file: string,
  currentHash: string | null,
  now: Date,
  config: VivaConfig,
): number {
  return ledger
    .filter((a) => a.person === person && a.file === file)
    .reduce((best, a) => Math.max(best, decayedMastery(a, currentHash, now, config)), 0);
}
