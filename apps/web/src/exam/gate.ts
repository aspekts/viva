import type { Gate, GateReason, Review } from "@viva/contracts";
import { ApiError } from "../api/errors";
import { pushAllowed } from "./verdict";

interface GateCopy {
  title: string;
  detail: string;
  /** Offered only when the push can be skipped, so the text never promises a button that is not there. */
  skipHint?: string;
}

/** Every reason has copy, and the Record type fails the build when the contract adds one. */
const COPY: Record<GateReason, GateCopy> = {
  "exam-passed": { title: "You defended it", detail: "Your answers met the rubric, so the push can go ahead." },
  "exam-failed": {
    title: "Not yet",
    detail: "At least one answer fell short. Read what you missed.",
    skipHint: "Or push on and leave the code under fog.",
  },
  "skipped-with-debt": { title: "Pushed with debt", detail: "You skipped the exam, so this code stays under fog." },
  "low-risk": { title: "Nothing to defend", detail: "This change was not risky enough to ask about." },
  "earned-trust": { title: "Already proven", detail: "You have already shown you understand this code." },
  "docs-only": { title: "Docs only", detail: "Only docs or lockfiles changed, so there is nothing to ask." },
  "too-large": {
    title: "Too big to review",
    detail: "This change is over the size limit. Split it up.",
    skipHint: "Or push on and leave the code under fog.",
  },
  "injection-suspected": {
    title: "Held for a person",
    detail: "Text in the diff tried to instruct Viva. A person has to look at it, and it cannot be skipped.",
  },
  "viva-config-changed": {
    title: "Held for a person",
    detail: "Viva's own config changed. A person has to approve that, and it cannot be skipped.",
  },
  "pipeline-error": { title: "Viva hit an error", detail: "The review could not finish. Run `git push` again." },
};

export interface GateView {
  title: string;
  detail: string;
  allowed: boolean;
  canSkip: boolean;
}

/** What to show for a finished review. Skip needs a blocked push the daemon says is skippable. */
export function describeGate(gate: Gate): GateView {
  const allowed = pushAllowed(gate);
  const canSkip = !allowed && gate.skippable;
  const { title, detail, skipHint } = COPY[gate.reason];
  return { title, detail: canSkip && skipHint ? `${detail} ${skipHint}` : detail, allowed, canSkip };
}

/**
 * Polls and events can land after a local submit or skip. A review that has
 * been skipped never goes back to a blocked one, so a late stale read is dropped.
 */
export function newerReview(current: Review | null, loaded: Review): Review {
  const skipped = current?.id === loaded.id && current.gate?.reason === "skipped-with-debt";
  return skipped && loaded.gate?.reason !== "skipped-with-debt" ? current : loaded;
}

export const skipErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.status === 404) {
    return "This review is no longer available. Run `git push` again to start a new one.";
  }
  if (error instanceof ApiError && error.status === 409) return "This review cannot be skipped.";
  return "Could not skip the review. Try again.";
};
