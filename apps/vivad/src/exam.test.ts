import { createElement } from "react";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Review, SavedMemory } from "@viva/contracts";
import memory from "../../../fixtures/mock/memory.json";
import sample from "../../../fixtures/mock/review.json";
import { DaemonClient } from "./client.js";
import { Exam } from "./exam.js";

afterEach(() => vi.restoreAllMocks());

it("takes typed answers question-by-question and submits the entire exam before showing the verdict", async () => {
  const initial = Review.parse({ ...sample, stage: "awaiting-exam", gate: null });
  const first = initial.plan!.questions[0]!;
  initial.plan!.questions = [first, { ...first, id: "q-next", ask: "And the next change?" }];
  const done: Review = { ...initial, stage: "done", gate: { verdict: "approve", reason: "exam-passed", skippable: true } };
  const client = new DaemonClient();
  const submit = vi.spyOn(client, "answer").mockResolvedValue(done);
  const finish = vi.fn();
  const fail = vi.fn();
  const app = render(createElement(Exam, { initial, client, finish, fail }));
  try {
    await vi.waitFor(() => expect(app.lastFrame()).toContain(first.ask));
    expect(app.lastFrame()).toContain(`${first.location.file}:${first.location.lines.join("–")}`);
    app.stdin.write("first typed answer");
    await vi.waitFor(() => expect(app.lastFrame()).toContain("first typed answer"));
    app.stdin.write("\r");
    await vi.waitFor(() => expect(app.lastFrame()).toContain("And the next change?"));
    expect(submit).not.toHaveBeenCalled();
    app.stdin.write("second typed answer");
    await vi.waitFor(() => expect(app.lastFrame()).toContain("second typed answer"));
    app.stdin.write("\r");
    await vi.waitFor(() => expect(app.lastFrame()).toContain("approve (exam-passed)"));
    expect(submit).toHaveBeenCalledWith(initial.id, [
      { questionId: first.id, transcript: "first typed answer", mode: "typed" },
      { questionId: "q-next", transcript: "second typed answer", mode: "typed" },
    ]);
    app.stdin.write("\r");
    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(done));
    expect(fail).not.toHaveBeenCalled();
  } finally { app.unmount(); }
});

it("never offers skip or calls the skip API for a hard gate", async () => {
  const initial = Review.parse({ ...sample, stage: "done", gate: { verdict: "defer", reason: "viva-config-changed", skippable: false } });
  const client = new DaemonClient();
  const skip = vi.spyOn(client, "skip");
  const app = render(createElement(Exam, { initial, client, finish: vi.fn(), fail: vi.fn() }));
  try {
    await vi.waitFor(() => expect(app.lastFrame()).toContain("Hard gate: cannot skip"));
    app.stdin.write("\u001b");
    app.stdin.write("y");
    expect(app.lastFrame()).not.toContain("skip with debt");
    expect(skip).not.toHaveBeenCalled();
  } finally { app.unmount(); }
});

describe("saving the explanation", () => {
  const passed = async (client: DaemonClient) => {
    const initial = Review.parse({ ...sample, stage: "awaiting-exam", gate: null });
    const done: Review = { ...initial, stage: "done", gate: { verdict: "approve", reason: "exam-passed", skippable: true } };
    vi.spyOn(client, "answer").mockResolvedValue(done);
    const fail = vi.fn();
    const app = render(createElement(Exam, { initial, client, finish: vi.fn(), fail }));
    await vi.waitFor(() => expect(app.lastFrame()).toContain(initial.plan!.questions[0]!.ask));
    app.stdin.write("my reasoning");
    await vi.waitFor(() => expect(app.lastFrame()).toContain("my reasoning"));
    app.stdin.write("\r");
    await vi.waitFor(() => expect(app.lastFrame()).toContain("approve (exam-passed)"));
    return { app, fail };
  };

  it("offers to save after a pass, and saves only when asked", async () => {
    const client = new DaemonClient();
    const save = vi.spyOn(client, "saveMemory").mockResolvedValue(SavedMemory.parse(memory));
    const { app, fail } = await passed(client);
    try {
      expect(app.lastFrame()).toContain("m: save your explanation as project memory");
      expect(save).not.toHaveBeenCalled();
      app.stdin.write("m");
      await vi.waitFor(() => expect(app.lastFrame()).toContain("Saved to .viva/memory/src/webhook.ts.md"));
      expect(save).toHaveBeenCalledTimes(1);
      expect(fail).not.toHaveBeenCalled();
    } finally { app.unmount(); }
  });

  it("keeps the verdict when saving fails", async () => {
    const client = new DaemonClient();
    vi.spyOn(client, "saveMemory").mockRejectedValue(new Error("disk full"));
    const { app, fail } = await passed(client);
    try {
      app.stdin.write("m");
      await vi.waitFor(() => expect(app.lastFrame()).toContain("Your push is unaffected"));
      expect(app.lastFrame()).toContain("approve (exam-passed)");
      expect(fail).not.toHaveBeenCalled();
    } finally { app.unmount(); }
  });
});
