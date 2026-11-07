import { renderEntry, type FileMap } from "@viva/engine";

/** A change judged against a decision recorded in `.viva/memory/`, graded on both flagging and not flagging. */
export interface DirectionCase {
  name: string;
  intent: string;
  before: FileMap;
  after: FileMap;
  /** "exam" means the change must trigger questions. */
  expect: "exam" | "low-risk";
  /** Whether a direction claim must be raised. */
  direction: boolean;
  /** Model calls: no relevant memory must mean no direction call. */
  llmCalls: number;
}

const pay = "export function pay(card) {\n  check(card);\n  return send(card);\n}\n";

const memory = "# Viva memory: src/pay.ts\n\n" + renderEntry({
  id: "eval-review/q1",
  reviewId: "eval-review",
  questionId: "q1",
  location: { file: "src/pay.ts", lines: [2, 3] },
  symbols: ["pay"],
  claim: "checking the card before sending it",
  question: "What happens if the card is sent before it is checked?",
  explanation: "The check has to come first. A bad card that is sent can't be recalled, so we validate before send on purpose.",
  person: "eval",
  at: "2026-11-07T20:00:00.000Z",
  commit: "0000000",
});

export const directionCases: DirectionCase[] = [
  {
    name: "reverses a recorded decision",
    intent: "return what send gives back",
    before: { "src/pay.ts": pay, ".viva/memory/src/pay.ts.md": memory },
    after: { "src/pay.ts": "export function pay(card) {\n  const sent = send(card);\n  check(card);\n  return sent;\n}\n" },
    expect: "exam",
    direction: true,
    // Three checks, the direction check, then the plan.
    llmCalls: 5,
  },
  {
    name: "consistent with a recorded decision",
    intent: "add a currency constant",
    before: { "src/pay.ts": pay, ".viva/memory/src/pay.ts.md": memory },
    after: { "src/pay.ts": `${pay}\nexport const currency = "GBP";\n` },
    expect: "low-risk",
    direction: false,
    llmCalls: 4,
  },
  {
    name: "same reversal with no memory",
    intent: "return what send gives back",
    before: { "src/pay.ts": pay },
    after: { "src/pay.ts": "export function pay(card) {\n  const sent = send(card);\n  check(card);\n  return sent;\n}\n" },
    expect: "low-risk",
    direction: false,
    // The direction check is skipped without a model call.
    llmCalls: 3,
  },
];
