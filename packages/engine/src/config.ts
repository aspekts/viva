/** Defaults for a review. Hard gates are deliberately not configurable here. */
export const defaults = {
  maxChangedLines: 1500,
  riskThreshold: 1,
  maxQuestions: 3,
  masteryHalfLifeDays: 14,
  /** Hard cap on model usage per review, so a bug cannot burn the budget. */
  maxInputTokens: 60_000,
  originWeight: { requested: 0.5, inferred: 1, silent: 2 },
} as const;

export type VivaConfig = typeof defaults;

/** Changing these always needs a human, as with Mabel's own config. */
export const PROTECTED_PATHS = [/^\.viva\/config\.json$/, /^\.viva\/checks\//];
