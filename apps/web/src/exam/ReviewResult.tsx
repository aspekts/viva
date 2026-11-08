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
  if (!gate) return null;
  const { allowed, canSkip, title, detail } = describeGate(gate);
  return (
    <section>
      <h1>{allowed ? "Push allowed" : "Push blocked"}</h1>
      <h2>{title}</h2>
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
              <ul aria-label="Points you missed">
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
        <button onClick={onSkip} disabled={skipping}>
          {skipping ? <span role="status">Skipping…</span> : "Push anyway, leave it under fog"}
        </button>
      )}
    </section>
  );
};
