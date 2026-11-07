import { useEffect, useState } from "react";
import type { Answer, Review } from "@viva/contracts";
import { reviewLoader, submitAnswers, watch } from "../api/client";
import { QuestionCode } from "./QuestionCode";

/** Typed exam first. Sophina adds the ElevenLabs voice session behind the same answers. */
export function ExamRoom({ reviewId }: { reviewId: string | null }) {
  const [review, setReview] = useState<Review | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const loader = reviewLoader(reviewId, (loaded) => {
      if (loaded) setReview(loaded);
      setEmpty(!loaded);
      setError(null);
    }, (e) => setError(e.message));
    loader.load();
    const stopWatching = watch("review", loader.load);
    return () => {
      stopWatching();
      loader.stop();
    };
  }, [reviewId]);

  if (error) return <p role="alert">Could not load this review: {error}</p>;
  if (empty) return <p>No reviews yet. Run git push in a repo with the Viva hook, and your exam appears here.</p>;
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
