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

export function rankClaims(
  claims: Claim[],
  inputsFor: (claim: Claim) => Omit<RiskInputs, "originWeight">,
  config: VivaConfig,
): RankedClaim[] {
  const ranked = claims
    .map((claim) => {
      const inputs = { ...inputsFor(claim), originWeight: config.originWeight[claim.origin] };
      return { ...claim, inputs, risk: riskScore(inputs) };
    })
    .sort((a, b) => b.risk - a.risk);
  return dedupeClaims(ranked);
}
