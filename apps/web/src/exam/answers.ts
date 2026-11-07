import type { Answer, Question } from "@viva/contracts";

/** Answers typed so far, by question id. */
export type Drafts = Readonly<Record<string, string>>;

/** The daemon needs an answer for every question: a missing or blank one scores zero. */
export const buildAnswers = (questions: readonly Question[], drafts: Drafts): Answer[] =>
  questions.map((q) => ({ questionId: q.id, transcript: drafts[q.id] ?? "", mode: "typed" }));

export const countUnanswered = (questions: readonly Question[], drafts: Drafts): number =>
  questions.filter((q) => (drafts[q.id] ?? "").trim() === "").length;
