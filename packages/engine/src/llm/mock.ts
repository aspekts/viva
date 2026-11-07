import type { CheckResult, ExamPlan, Grade } from "@viva/contracts";
import { estimateTokens, type LlmProvider, type LlmRequest, type LlmResult } from "./provider.js";

const RISKY = /\b(charge|delete|drop|timeout|retry|idempot\w*|auth\w*|token|lock|await|or|not|null)\b/i;

function checkResponse(user: string): CheckResult {
  const claims: CheckResult["claims"] = [];
  const intent = /<untrusted name="intent">\n([\s\S]*?)\n<\/untrusted>/.exec(user)?.[1] ?? "";
  let file = "unknown";
  let line = 1;
  for (const raw of user.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(raw);
    if (header) file = header[1] ?? file;
    const hunk = /^@@ .* \+(\d+)/.exec(raw);
    if (hunk) line = Number(hunk[1]);
    if (raw.startsWith("+") && !raw.startsWith("+++") && RISKY.test(raw)) {
      const word = RISKY.exec(raw)?.[0] ?? "";
      claims.push({
        summary: `Changed logic around "${word}"`,
        origin: intent.toLowerCase().includes(word.toLowerCase()) ? "requested" : "silent",
        symbols: [],
        location: { file, lines: [line, line] },
        evidence: "Mock heuristic: risky keyword on an added line",
      });
      break;
    }
    if (!raw.startsWith("-")) line += 1;
  }
  return { claims };
}

function planResponse(user: string): ExamPlan {
  const claims = JSON.parse(/<untrusted name="claims">\n([\s\S]*?)\n<\/untrusted>/.exec(user)?.[1] ?? "[]");
  return {
    questions: claims.slice(0, 3).map((c: { id: string; summary: string; location: ExamPlan["questions"][number]["location"] }, i: number) => ({
      id: `q${i + 1}`,
      claimId: c.id,
      ask: `What behaviour changes because of this: ${c.summary}?`,
      mustMention: ["behaviour"],
      followUpIfVague: "Walk me through what happens at runtime.",
      location: c.location,
    })),
  };
}

function gradeResponse(user: string): { grades: Grade[] } {
  const answer = /<untrusted name="answer">\n([\s\S]*?)\n<\/untrusted>/.exec(user)?.[1] ?? "";
  const id = /question_id: (\S+)/.exec(user)?.[1] ?? "q1";
  const mustMention: string[] = JSON.parse(/must_mention: (\[.*\])/.exec(user)?.[1] ?? "[]");
  const missing = mustMention.filter((m) => !answer.toLowerCase().includes(m.toLowerCase()));
  const score = mustMention.length ? 1 - missing.length / mustMention.length : 0;
  return { grades: [{ questionId: id, verdict: score >= 0.5 ? "approve" : "reject", score, missing }] };
}

/** Deterministic stand-in, so everything runs offline and in CI. It proves nothing about model quality. */
export class MockProvider implements LlmProvider {
  readonly id = "mock";

  async complete<T>({ name, user, schema }: LlmRequest<T>): Promise<LlmResult<T>> {
    const body = name.startsWith("check:") ? checkResponse(user) : name === "plan" ? planResponse(user) : gradeResponse(user);
    return { value: schema.parse(body), inputTokens: estimateTokens(user), outputTokens: 50 };
  }
}
