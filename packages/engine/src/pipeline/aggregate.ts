import { worstVerdict, type Gate, type Grade } from "@viva/contracts";

/** Worst wins across every graded question. */
export function aggregateGrades(grades: Grade[]): Gate {
  // With nothing graded, worst-wins would default to endorse.
  if (grades.length === 0) throw new Error("cannot decide an exam with no graded answers");
  const verdict = worstVerdict(grades.map((g) => g.verdict));
  const passed = verdict === "approve" || verdict === "endorse";
  return { verdict, reason: passed ? "exam-passed" : "exam-failed", skippable: true };
}

/** What the pre-push hook does with a gate. Only these two outcomes exist. */
export function allowsPush(gate: Gate): boolean {
  return gate.verdict === "approve" || gate.verdict === "endorse";
}
