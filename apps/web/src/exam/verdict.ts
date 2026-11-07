import type { Gate } from "@viva/contracts";

/** The one rule for letting a push through. Reuse it rather than inventing another. */
export const pushAllowed = (gate: Gate): boolean => gate.verdict === "approve" || gate.verdict === "endorse";
