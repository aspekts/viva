import { describe, expect, it, vi } from "vitest";
import type { Review } from "@viva/contracts";
import { RpcError, VivaAcpAgent } from "./acp.js";

const question = (id: string, ask: string) => ({
  id, claimId: `c-${id}`, ask, mustMention: ["secret rubric"], followUpIfVague: "", location: { file: "src/webhook.js", lines: [6, 8] as [number, number] },
});
const pending = {
  id: "r1", stage: "awaiting-exam", gate: null, grades: [],
  request: { repoPath: "/repo", base: "b", head: "h", person: "Marcus" },
  claims: [{ origin: "silent" }],
  plan: { questions: [question("q1", "What happens on a duplicate?"), question("q2", "Why retry?")] },
} as unknown as Review;
const passed = { ...pending, stage: "done", gate: { verdict: "endorse", reason: "exam-passed", skippable: true }, grades: [{ questionId: "q1", verdict: "endorse", score: 1, missing: [] }] } as unknown as Review;

const text = (t: string) => [{ type: "text", text: t }];

function setup() {
  const updates: { method: string; params: { update: Record<string, unknown> } }[] = [];
  const daemon = { start: vi.fn(async () => pending), answer: vi.fn(async () => passed), skip: vi.fn(async () => passed) };
  const agent = new VivaAcpAgent((method, params) => updates.push({ method, params: params as never }), daemon, () => ({ repoPath: "/repo", base: "b".repeat(40), head: "h".repeat(40), person: "Marcus", intent: "Add retries" }));
  const said = () => updates.filter((u) => u.params.update.sessionUpdate === "agent_message_chunk").map((u) => (u.params.update.content as { text: string }).text).join("");
  return { agent, daemon, updates, said };
}

describe("ACP agent", () => {
  it("initializes and refuses a relative cwd", async () => {
    const { agent } = setup();
    expect(await agent.handle("initialize", { protocolVersion: 1 })).toMatchObject({ protocolVersion: 1 });
    await expect(agent.handle("session/new", { cwd: "repo", mcpServers: [] })).rejects.toBeInstanceOf(RpcError);
  });

  it("asks each question in turn, points at the code, then submits the answers", async () => {
    const { agent, daemon, updates, said } = setup();
    const { sessionId } = (await agent.handle("session/new", { cwd: "/repo", mcpServers: [] })) as { sessionId: string };
    expect(await agent.handle("session/prompt", { sessionId, prompt: text("review") })).toEqual({ stopReason: "end_turn" });
    expect(said()).toContain("Question 1 of 2");
    expect(updates.find((u) => u.params.update.sessionUpdate === "tool_call")?.params.update.locations).toEqual([{ path: "/repo/src/webhook.js", line: 6 }]);

    await agent.handle("session/prompt", { sessionId, prompt: text("It charges twice") });
    expect(said()).toContain("Question 2 of 2");
    await agent.handle("session/prompt", { sessionId, prompt: text("Gateway timeouts") });
    expect(daemon.answer).toHaveBeenCalledWith("r1", [
      { questionId: "q1", transcript: "It charges twice", mode: "typed" },
      { questionId: "q2", transcript: "Gateway timeouts", mode: "typed" },
    ]);
    expect(said()).toContain("Push allowed");
    expect(said()).not.toContain("secret rubric");
  });

  it("skips with debt on request and reports daemon failures instead of crashing", async () => {
    const { agent, daemon, said } = setup();
    const { sessionId } = (await agent.handle("session/new", { cwd: "/repo", mcpServers: [] })) as { sessionId: string };
    await agent.handle("session/prompt", { sessionId, prompt: text("go") });
    await agent.handle("session/prompt", { sessionId, prompt: text("skip") });
    expect(daemon.skip).toHaveBeenCalledWith("r1");
    daemon.start.mockRejectedValueOnce(new Error("connection refused"));
    await agent.handle("session/prompt", { sessionId, prompt: text("review") });
    expect(said()).toContain("connection refused");
  });
});
