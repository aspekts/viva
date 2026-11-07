import { useEffect, useState } from "react";
import type { Answer, Review } from "@viva/contracts";
import { getReview, submitAnswers, watch } from "../api/client";
import { QuestionCode } from "./QuestionCode";

/** Typed exam first. Sophina adds the ElevenLabs voice session behind the same answers. */
export function ExamRoom({ reviewId }: { reviewId: string | null }) {
  const [review, setReview] = useState<Review | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => getReview(reviewId).then((loaded) => { setReview(loaded); setError(null); }, (e: Error) => setError(e.message));
    load();
    return watch("review", load);
  }, [reviewId]);

  if (error) return <p role="alert">Could not load this review: {error}</p>;
  if (!review) return <p>Loading the exam…</p>;
  if (review.gate) return <h1>Verdict: {review.gate.verdict} ({review.gate.reason})</h1>;

  const questions = review.plan?.questions ?? [];
  const submit = async () => {
    const answers: Answer[] = questions.map((q) => ({
      questionId: q.id,
      transcript: drafts[q.id] ?? "",
      mode: "typed",
    }));
    setReview(await submitAnswers(review.id, answers));
  };

  return (
    <section>
      <h1>Can you defend this change?</h1>
      {questions.map((q) => (
        <label key={q.id} className="question">
          <span>{q.ask}</span>
          <small>
            {q.location.file}:{q.location.lines[0]}
          </small>
          <QuestionCode reviewId={review.id} location={q.location} />
          <textarea
            value={drafts[q.id] ?? ""}
            onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })}
          />
        </label>
      ))}
      <button onClick={submit}>Submit answers</button>
    </section>
  );
}
