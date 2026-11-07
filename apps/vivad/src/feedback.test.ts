import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { ReviewFeedback } from "@viva/contracts";
import sample from "../../../fixtures/mock/feedback.json";
import { formatFeedback, handToAgent } from "./feedback.js";

vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: vi.fn() }));
afterEach(() => vi.clearAllMocks());

it.each(["claude", "codex"] as const)("hands feedback to %s over stdin and propagates the exit code", async (agent) => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough() });
  let received = "";
  child.stdin.on("data", (chunk) => { received += chunk.toString(); });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const text = "<untrusted>--dangerous-flag; $(not-a-command)</untrusted>";
  const result = handToAgent(agent, text, process.cwd());
  const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
  if (process.platform === "win32") {
    expect(command).toBe(process.env.ComSpec ?? "cmd.exe");
    expect(args).toEqual(["/d", "/s", "/c", agent === "claude" ? "claude -p" : "codex exec -"]);
  } else {
    expect(command).toBe(agent);
    expect(args).toEqual(agent === "claude" ? ["-p"] : ["exec", "-"]);
  }
  expect(options).toMatchObject({ shell: false, cwd: process.cwd(), stdio: ["pipe", "inherit", "inherit"] });
  expect(received).toBe(text);
  expect(JSON.stringify(args)).not.toContain("dangerous");
  child.emit("close", 7);
  expect(await result).toBe(7);
});

it("reports an unavailable opted-in agent rather than silently succeeding", async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const result = handToAgent("codex", "feedback", process.cwd());
  child.emit("error", new Error("ENOENT"));
  await expect(result).rejects.toThrow("ENOENT");
});


it("sanitizes model questions and missed concepts before feedback is printed", () => {
  const feedback = ReviewFeedback.parse(sample);
  feedback.items[0]!.ask = "\x1b[2JQuestion\nnext";
  feedback.items[0]!.missing = ["\x1b]0;owned\x07concept\r\x85"];
  const text = formatFeedback(feedback);
  expect(text).toContain("Question\nnext");
  expect(text).toContain("Missed: concept");
  expect(text).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  expect(text).not.toContain("owned");
});
