import { act, createElement } from "react";
import { render } from "ink-testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Review } from "@viva/contracts";
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
