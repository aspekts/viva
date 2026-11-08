import type { Claim, RankedClaim, RiskInputs } from "@viva/contracts";
import type { VivaConfig } from "../config.js";

/** Plain arithmetic, so a judge can follow every score. No model involved. */
export function riskScore({ blastRadius, originWeight, untested, mastery }: RiskInputs): number {
  return (1 + Math.log1p(blastRadius)) * originWeight * (0.5 + 0.5 * untested) * (1 - mastery);
}

const overlaps = (a: Claim, b: Claim) =>
  a.location.file === b.location.file &&
  a.location.lines[0] <= b.location.lines[1] &&
  b.location.lines[0] <= a.location.lines[1];

/** Several checks often spot the same change. Keep the riskiest of each overlap. */
export function dedupeClaims(ranked: RankedClaim[]): RankedClaim[] {
  return ranked.reduce<RankedClaim[]>((kept, claim) => (kept.some((k) => overlaps(k, claim)) ? kept : [...kept, claim]), []);
}

/**
 * Riskiest first. Pinned claims, which must be examined whatever their score, come
 * before the rest, so they also win any overlap with an unpinned claim.
 */
export function rankClaims(
  claims: Claim[],
  inputsFor: (claim: Claim) => Omit<RiskInputs, "originWeight">,
  config: VivaConfig,
  pinned: (claim: Claim) => boolean = () => false,
): RankedClaim[] {
  const ranked = claims
    .map((claim) => {
      const inputs = { ...inputsFor(claim), originWeight: config.originWeight[claim.origin] };
      return { ...claim, inputs, risk: riskScore(inputs) };
    })
    .sort((a, b) => Number(pinned(b)) - Number(pinned(a)) || b.risk - a.risk);
  return dedupeClaims(ranked);
}
