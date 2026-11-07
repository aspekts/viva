import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { handToAgent } from "./feedback.js";

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
