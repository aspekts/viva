import type { Question, Review } from "@viva/contracts";

/**
 * What the examiner agent is told. The rubric (`mustMention`) is never sent: the
 * examiner asks, and the separate grader marks the transcript.
 */
export function examinerVariables(review: Review, questions: readonly Question[]): Record<string, string | number> {
  return {
    person: review.request.person || "there",
    question_count: questions.length,
    questions: JSON.stringify(
      questions.map((q) => ({
        id: q.id,
        ask: q.ask,
        follow_up_if_vague: q.followUpIfVague,
        code: `${q.location.file} lines ${q.location.lines[0]}-${q.location.lines[1]}`,
      })),
    ),
  };
}

/** Adds what the person just said to their answer, keeping anything they typed. */
export function appendSpoken(draft: string | undefined, spoken: string): string {
  const text = spoken.trim();
  if (!text) return draft ?? "";
  const existing = (draft ?? "").trimEnd();
  return existing ? `${existing} ${text}` : text;
}

/** The agent names a question by ID. Anything else is ignored rather than trusted. */
export function knownQuestion(questions: readonly Question[], id: unknown): string | null {
  return typeof id === "string" && questions.some((q) => q.id === id) ? id : null;
}
