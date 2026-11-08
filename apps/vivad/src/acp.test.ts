import { join } from "node:path";
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
  const agent = new VivaAcpAgent(
    (method, params) => updates.push({ method, params: params as never }),
    daemon,
    () => ({ repoPath: "/repo", base: "b".repeat(40), head: "h".repeat(40), person: "Marcus", intent: "Add retries" }),
    (_repo, rev) => (rev === "b" ? "check(); charge();\n" : "charge(); check();\n"),
  );
  const said = () => updates.filter((u) => u.params.update.sessionUpdate === "agent_message_chunk").map((u) => (u.params.update.content as { text: string }).text).join("");
  return { agent, daemon, updates, said };
}

describe("ACP agent", () => {
  it("initializes and refuses a relative cwd", async () => {
    const { agent } = setup();
    expect(await agent.handle("initialize", { protocolVersion: 1 })).toMatchObject({ protocolVersion: 1 });
    await expect(agent.handle("session/new", { cwd: "repo", mcpServers: [] })).rejects.toBeInstanceOf(RpcError);
    const { sessionId } = (await agent.handle("session/new", { cwd: "/repo", mcpServers: [] })) as { sessionId: string };
    expect(await agent.handle("session/list", { cwd: "/repo" })).toMatchObject({ sessions: [{ sessionId, cwd: "/repo" }] });
    expect(await agent.handle("session/list", { cwd: "/elsewhere" })).toEqual({ sessions: [] });
  });

  it("asks each question in turn, points at the code, then submits the answers", async () => {
    const { agent, daemon, updates, said } = setup();
    const { sessionId } = (await agent.handle("session/new", { cwd: "/repo", mcpServers: [] })) as { sessionId: string };
    expect(await agent.handle("session/prompt", { sessionId, prompt: text("review") })).toEqual({ stopReason: "end_turn" });
    expect(said()).toContain("Question 1 of 2");
    const call = updates.find((u) => u.params.update.sessionUpdate === "tool_call")!.params.update;
    const file = join("/repo", "src/webhook.js");
    expect(call.locations).toEqual([{ path: file, line: 6 }]);
    expect(call.content).toEqual([{ type: "diff", path: file, oldText: "check(); charge();\n", newText: "charge(); check();\n" }]);
    const plans = () => updates.filter((u) => u.params.update.sessionUpdate === "plan").map((u) => (u.params.update.entries as { status: string }[]).map((e) => e.status));
    expect(plans().at(-1)).toEqual(["in_progress", "pending"]);

    await agent.handle("session/prompt", { sessionId, prompt: text("Review shows it charges twice") });
    expect(said()).toContain("Question 2 of 2");
    await agent.handle("session/prompt", { sessionId, prompt: text("Gateway timeouts") });
    expect(daemon.answer).toHaveBeenCalledWith("r1", [
      { questionId: "q1", transcript: "Review shows it charges twice", mode: "typed" },
      { questionId: "q2", transcript: "Gateway timeouts", mode: "typed" },
    ]);
    expect(said()).toContain("Push allowed");
    expect(plans().at(-1)).toEqual(["completed", "completed"]);
    expect(said()).not.toContain("secret rubric");
  });

  it("skips with debt on request and reports daemon failures instead of crashing", async () => {
    const { agent, daemon, said } = setup();
    const { sessionId } = (await agent.handle("session/new", { cwd: "/repo", mcpServers: [] })) as { sessionId: string };
    await agent.handle("session/prompt", { sessionId, prompt: text("go") });
    await agent.handle("session/prompt", { sessionId, prompt: text("/skip") });
    expect(daemon.skip).toHaveBeenCalledWith("r1");
    daemon.start.mockRejectedValueOnce(new Error("connection refused"));
    await agent.handle("session/prompt", { sessionId, prompt: text("review") });
    expect(said()).toContain("connection refused");
  });
});

describe("Rex's guide", () => {
  it("shows game over on a failed exam, then walks through each flag step by step", async () => {
    const failed = {
      ...pending, stage: "done", gate: { verdict: "reject", reason: "exam-failed", skippable: true },
      claims: [{ id: "c-q1", origin: "silent", summary: "Moved the duplicate check after the charge", evidence: "A repeat event charges twice" }],
      plan: { questions: [question("q1", "What happens on a duplicate?")] },
      grades: [{ questionId: "q1", verdict: "reject", score: 0, missing: ["charged twice"] }],
    } as unknown as Review;
    const { agent, daemon, said } = setup();
    daemon.start.mockResolvedValueOnce(failed);
    const { sessionId } = (await agent.handle("session/new", { cwd: "/repo", mcpServers: [] })) as { sessionId: string };
    await agent.handle("session/prompt", { sessionId, prompt: text("/review") });
    expect(said()).toContain("G A M E   O V E R");
    await agent.handle("session/prompt", { sessionId, prompt: text("/guide") });
    expect(said()).toContain("Step 1 of 3");
    expect(said()).toContain("Nobody asked for this");
    await agent.handle("session/prompt", { sessionId, prompt: text("next") });
    expect(said()).toContain("A repeat event charges twice");
    await agent.handle("session/prompt", { sessionId, prompt: text("next") });
    expect(said()).toContain("- charged twice");
    await agent.handle("session/prompt", { sessionId, prompt: text("next") });
    expect(said()).toContain("That's the whole run");
    expect(daemon.start).toHaveBeenCalledTimes(1);
  });
});
