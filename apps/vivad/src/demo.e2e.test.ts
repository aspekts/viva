import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { MockProvider } from "@viva/engine";
import { expect, it } from "vitest";
import { createApp } from "./app.js";

const exec = promisify(execFile);
const setup = fileURLToPath(new URL("../../../demo/setup.ts", import.meta.url));

/** Runs on every CI OS, so this is the Windows check for pnpm demo and the hook it installs. */
it("builds the demo repo, installs the hook, and blocks the agent's push", async () => {
  const root = mkdtempSync(join(tmpdir(), "viva-demo-"));
  const dir = join(root, "shop");
  const server = serve({ fetch: createApp(new MockProvider()).fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const env = { ...process.env, VIVA_LLM: "mock", VIVA_PORT: String(address.port), CI: "1" };
  try {
    await exec(process.execPath, ["--import", "tsx", setup, dir], { env, timeout: 60_000 });
    const hook = readFileSync(join(dir, ".git", "hooks", "pre-push"), "utf8");
    expect(hook).toContain("viva gate");
    expect(existsSync(`${dir}-origin.git`)).toBe(true);

    const { stdout } = await exec("git", ["log", "--format=%s", "origin/main..HEAD"], { cwd: dir, env });
    expect(stdout.trim()).toBe("Add retries to the payment webhook");

    const pushed = await exec("git", ["push"], { cwd: dir, env, timeout: 60_000 }).catch((error: { code: number; stderr: string }) => error);
    expect(pushed).toHaveProperty("code", 1);
    expect((pushed as { stderr: string }).stderr).toContain("exam required; push blocked");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
