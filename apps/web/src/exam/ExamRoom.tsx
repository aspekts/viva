import { useEffect, useState } from "react";
import type { Review } from "@viva/contracts";
import { reviewLoader, submitAnswers, watch } from "../api/client";
import { buildAnswers, countUnanswered, type Drafts } from "./answers";
import { loadErrorMessage, submitErrorMessage } from "./messages";
import { QuestionCode } from "./QuestionCode";
import { pushAllowed } from "./verdict";

const ReviewResult = ({ review }: { review: Review }) => {
  const gate = review.gate;
  if (!gate) return null;
  const allowed = pushAllowed(gate);
  return (
    <section>
      <h1>{allowed ? "Push allowed" : "Push blocked"}</h1>
      <p>
        Verdict: {gate.verdict} ({gate.reason})
      </p>
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
    </section>
  );
};

/** Typed exam first. Sophina adds the ElevenLabs voice session behind the same answers. */
export function ExamRoom({ reviewId }: { reviewId: string | null }) {
  const [review, setReview] = useState<Review | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const loader = reviewLoader(
      reviewId,
      (loaded) => {
        if (loaded) setReview(loaded);
        setEmpty(!loaded);
        setLoadError(null);
      },
      (e) => setLoadError(loadErrorMessage(e)),
    );
    loader.load();
    const stopWatching = watch("review", loader.load);
    return () => {
      stopWatching();
      loader.stop();
    };
  }, [reviewId]);

  if (loadError) return <p role="alert">{loadError}</p>;
  if (empty) return <p>No reviews yet. Run git push in a repo with the Viva hook, and your exam appears here.</p>;
  if (!review) return <p role="status">Loading the exam…</p>;
  if (review.gate) return <ReviewResult review={review} />;

  const questions = review.plan?.questions ?? [];
  if (questions.length === 0) return <p>This review has no questions to answer.</p>;
  const unanswered = countUnanswered(questions, drafts);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      setReview(await submitAnswers(review.id, buildAnswers(questions, drafts)));
    } catch (e: unknown) {
      setSubmitError(submitErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <h1>Can you defend this change?</h1>
      {questions.map((q, index) => (
        <label key={q.id} className="question">
          <span>
            {index + 1} of {questions.length}: {q.ask}
          </span>
          <small>
            {q.location.file}:{q.location.lines[0]}
          </small>
          <QuestionCode reviewId={review.id} location={q.location} />
          <textarea
            value={drafts[q.id] ?? ""}
            disabled={submitting}
            onChange={(e) => {
              const { value } = e.target;
              setDrafts((current) => ({ ...current, [q.id]: value }));
            }}
          />
        </label>
      ))}
      {unanswered > 0 && (
        <p>
          {unanswered === questions.length
            ? "Answer at least one question to submit."
            : `${unanswered} unanswered. Blank answers score zero.`}
        </p>
      )}
      {submitError && <p role="alert">{submitError}</p>}
      <button onClick={submit} disabled={submitting || unanswered === questions.length}>
        {submitting ? <span role="status">Grading…</span> : "Submit answers"}
      </button>
    </section>
  );
}
