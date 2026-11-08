import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const setup = fileURLToPath(new URL("../../../demo/setup.ts", import.meta.url));

it("builds a demo with an installed hook and one unpushed risky commit outside Viva's workspace", async () => {
  const directory = mkdtempSync(join(tmpdir(), "viva-demo-setup-"));
  const repo = join(directory, "shop with spaces");
  // The demo's parent must not decide which pnpm version installs Viva's hook.
  writeFileSync(join(directory, "package.json"), '{"packageManager":"pnpm@0.0.0"}');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Demo Test", GIT_AUTHOR_EMAIL: "demo@example.test",
    GIT_COMMITTER_NAME: "Demo Test", GIT_COMMITTER_EMAIL: "demo@example.test",
  };
  const git = (...args: string[]) => exec("git", args, { cwd: repo, env, timeout: 10_000 });
  try {
    const result = await exec(process.execPath, ["--import", "tsx", setup, repo], { cwd: root, env, timeout: 30_000 });
    expect(result.stdout).toContain(`Demo repo ready: ${repo}`);
    expect((await git("status", "--porcelain")).stdout).toBe("");
    expect((await git("rev-list", "--count", "@{upstream}..HEAD")).stdout.trim()).toBe("1");
    expect((await git("remote", "get-url", "origin")).stdout.trim()).toBe(`${repo}-origin.git`);
    expect(readFileSync(join(repo, ".git", "hooks", "pre-push"), "utf8")).toContain("# viva gate");
    const before = (await git("show", "@{upstream}:src/webhook.js")).stdout;
    const after = readFileSync(join(repo, "src", "webhook.js"), "utf8");
    expect(before.indexOf("store.hasProcessed")).toBeLessThan(before.indexOf("await chargeCard"));
    expect(after.indexOf("await withRetry")).toBeLessThan(after.indexOf("store.hasProcessed"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 45_000);
