import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("node:util", async (original) => ({
  ...await original<typeof import("node:util")>(), promisify: () => state.run,
}));
vi.mock("../sources/git.js", () => ({ git: async () => (await import("node:os")).tmpdir() }));
import { syncLedger } from "./sync.js";
import { appendAttestations } from "./notes.js";

function setup(core = "") {
  state.run.mockReset().mockImplementation(async (_git, args: string[]) => {
    if (args[0] === "config") return { stdout: core };
    return { stdout: "abc" };
  });
}
afterEach(() => vi.unstubAllEnvs());

it.each(["GIT_SSH_COMMAND", "GIT_SSH", "core.sshCommand", "default"])("respects %s when configuring SSH and disables recursive pushes", async (setting) => {
  vi.stubEnv("GIT_SSH_COMMAND", undefined);
  vi.stubEnv("GIT_SSH", undefined);
  if (setting === "GIT_SSH_COMMAND" || setting === "GIT_SSH") vi.stubEnv(setting, "custom-ssh");
  setup(setting === "core.sshCommand" ? "custom-ssh" : "");
  expect(await syncLedger(tmpdir())).toBe(true);
  const calls = state.run.mock.calls;
  const options = calls.find((call) => call[1][0] === "fetch")![2];
  expect(options.timeout).toBeGreaterThan(15_000);
  expect(options.env.GIT_SSH_COMMAND).toBe(setting === "default" ? "ssh -o BatchMode=yes -o ConnectTimeout=10" : setting === "GIT_SSH_COMMAND" ? "custom-ssh" : undefined);
  expect(calls.find((call) => call[1][0] === "push")![1]).toContain("--recurse-submodules=no");
  expect(calls.find((call) => call[1][0] === "notes")![2].timeout).toBeUndefined();
});

it("returns at the outer deadline even if a helper holds pipes open, without blocking appends", async () => {
  setup();
  let entered!: () => void;
  const fetching = new Promise<void>((resolve) => { entered = resolve; });
  state.run.mockImplementation(async (_git, args: string[]) => {
    if (args[0] === "fetch") { entered(); return new Promise(() => {}); }
    return { stdout: "" };
  });
  const pending = syncLedger(tmpdir(), { timeoutMs: 50 });
  await fetching;
  await appendAttestations(tmpdir(), "HEAD", [{ person: "Test", file: "x", symbol: "x", codeHash: "abc", score: 1, at: new Date().toISOString(), reviewId: "test" }]);
  expect(await pending).toBe(false);
});
