import { createElement } from "react";
import { render } from "ink-testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Review } from "@viva/contracts";
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
