import { useEffect, useRef } from "react";
import type { Review } from "@viva/contracts";
import { describeGate } from "./gate";

interface ReviewResultProps {
  review: Review;
  skipping: boolean;
  skipError: string | null;
  onSkip: () => void;
}

/** The finished review: whether the push can go ahead, why, what was missed, and skip if allowed. */
export const ReviewResult = ({ review, skipping, skipError, onSkip }: ReviewResultProps) => {
  const { gate } = review;
  const heading = useRef<HTMLHeadingElement>(null);
  // The exam swaps for the result, so move focus there to have the verdict read out.
  useEffect(() => heading.current?.focus(), []);
  if (!gate) return null;
  const { allowed, canSkip, title, detail } = describeGate(gate);
  return (
    <section className={allowed ? "result" : "result result-blocked"}>
      <h1 ref={heading} tabIndex={-1}>
        <span className="result-badge">{allowed ? "Push allowed" : "Push blocked"}</span> {title}
      </h1>
      <p>{detail}</p>
      {review.grades.map((grade) => {
        const question = review.plan?.questions.find((q) => q.id === grade.questionId);
        return (
          <article key={grade.questionId} className="question">
            <span>{question?.ask ?? grade.questionId}</span>
            <small>
              {grade.verdict}, {Math.round(grade.score * 100)}%
            </small>
            {grade.missing.length > 0 && (
              <ul className="missed" aria-label="Points you missed">
                {grade.missing.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
      {skipError && <p role="alert">{skipError}</p>}
      {canSkip && (
        <button onClick={skipping ? undefined : onSkip} aria-disabled={skipping}>
          Push anyway, leave it under fog
        </button>
      )}
      <p role="status">{skipping ? "Skipping…" : ""}</p>
    </section>
  );
};
