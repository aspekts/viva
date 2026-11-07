import { act, createElement } from "react";
import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Review, SavedMemory } from "@viva/contracts";
import memory from "../../../fixtures/mock/memory.json";
import sample from "../../../fixtures/mock/review.json";
import { DaemonClient } from "./client.js";
import { Exam } from "./exam.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("takes typed answers question-by-question and submits the entire exam before showing the verdict", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const initial = Review.parse({ ...sample, stage: "awaiting-exam", gate: null });
  const first = initial.plan!.questions[0]!;
  initial.plan!.questions = [first, { ...first, id: "q-next", ask: "And the next change?" }];
  const done: Review = { ...initial, stage: "done", gate: { verdict: "approve", reason: "exam-passed", skippable: true } };
  const client = new DaemonClient();
  const submit = vi.spyOn(client, "answer").mockResolvedValue(done);
  const finish = vi.fn();
  const fail = vi.fn();
  let app!: ReturnType<typeof render>;
  await act(async () => { app = render(createElement(Exam, { initial, client, finish, fail })); });
  try {
    await vi.waitFor(() => expect(app.lastFrame()).toContain(first.ask));
    expect(app.lastFrame()).toContain(`${first.location.file}:${first.location.lines.join("–")}`);
    await act(async () => { app.stdin.write("first typed answer"); });
    await vi.waitFor(() => expect(app.lastFrame()).toContain("first typed answer"));
    await act(async () => { app.stdin.write("\r"); });
    await vi.waitFor(() => expect(app.lastFrame()).toContain("And the next change?"));
    expect(submit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain("first typed answer"));
    await act(async () => { app.stdin.write("second typed answer"); });
    await vi.waitFor(() => expect(app.lastFrame()).toContain("second typed answer"));
    await act(async () => { app.stdin.write("\r"); });
    await vi.waitFor(() => expect(app.lastFrame()).toContain("approve (exam-passed)"));
    expect(submit).toHaveBeenCalledWith(initial.id, [
      { questionId: first.id, transcript: "first typed answer", mode: "typed" },
      { questionId: "q-next", transcript: "second typed answer", mode: "typed" },
    ]);
    await act(async () => { app.stdin.write("\r"); });
    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(done));
    expect(fail).not.toHaveBeenCalled();
  } finally { await act(async () => { app.unmount(); }); }
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
  // Input goes through act(), as above, so a busy test run can't drop a keypress.
  const passed = async (client: DaemonClient) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const initial = Review.parse({ ...sample, stage: "awaiting-exam", gate: null });
    const done: Review = { ...initial, stage: "done", gate: { verdict: "approve", reason: "exam-passed", skippable: true } };
    vi.spyOn(client, "answer").mockResolvedValue(done);
    const fail = vi.fn();
    let app!: ReturnType<typeof render>;
    await act(async () => { app = render(createElement(Exam, { initial, client, finish: vi.fn(), fail })); });
    await vi.waitFor(() => expect(app.lastFrame()).toContain(initial.plan!.questions[0]!.ask));
    await act(async () => { app.stdin.write("my reasoning"); });
    await vi.waitFor(() => expect(app.lastFrame()).toContain("my reasoning"));
    await act(async () => { app.stdin.write("\r"); });
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
      await act(async () => { app.stdin.write("m"); });
      await vi.waitFor(() => expect(app.lastFrame()).toContain("Saved to .viva/memory/src/webhook.ts.md"));
      expect(save).toHaveBeenCalledTimes(1);
      expect(fail).not.toHaveBeenCalled();
    } finally { await act(async () => { app.unmount(); }); }
  });

  it("keeps the verdict when saving fails", async () => {
    const client = new DaemonClient();
    vi.spyOn(client, "saveMemory").mockRejectedValue(new Error("disk full"));
    const { app, fail } = await passed(client);
    try {
      await act(async () => { app.stdin.write("m"); });
      await vi.waitFor(() => expect(app.lastFrame()).toContain("Your push is unaffected"));
      expect(app.lastFrame()).toContain("approve (exam-passed)");
      expect(fail).not.toHaveBeenCalled();
    } finally { await act(async () => { app.unmount(); }); }
  });
});

it("sanitizes questions and missed concepts in Ink output", async () => {
  const initial = Review.parse({ ...sample, stage: "awaiting-exam", gate: null });
  initial.plan!.questions[0]!.ask = "\x1b[2JQuestion\x07\r\x85";
  const app = render(createElement(Exam, { initial, client: new DaemonClient(), finish: vi.fn(), fail: vi.fn() }));
  try {
    await vi.waitFor(() => expect(app.lastFrame()).toContain("Question"));
    expect(app.lastFrame()).not.toContain("\x1b[2J");
    expect(app.lastFrame()).not.toMatch(/[\x07\x0d\x85]/);
  } finally { app.unmount(); }
  const done = Review.parse({ ...sample, stage: "done", gate: { verdict: "reject", reason: "exam-failed", skippable: true },
    grades: [{ questionId: "q1", verdict: "reject", score: 0, missing: ["\x1b]0;owned\x07concept\x08"] }],
  });
  const graded = render(createElement(Exam, { initial: done, client: new DaemonClient(), finish: vi.fn(), fail: vi.fn() }));
  try {
    await vi.waitFor(() => expect(graded.lastFrame()).toContain("missed: concept"));
    expect(graded.lastFrame()).not.toContain("owned");
    expect(graded.lastFrame()).not.toMatch(/[\x07\x08]/);
  } finally { graded.unmount(); }
});
