import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { Review } from "@viva/contracts";
import { MockProvider } from "@viva/engine";
import { expect, it } from "vitest";
import { fixtureRepo } from "../../../packages/engine/src/testing.js";
import { createApp } from "./app.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));

/** Real git hook + HTTP daemon + bare remote. No live model or browser. */
it("blocks a nonterminal push quickly, reuses a passed exam across restart, and fails open with daemon down", async () => {
  const { repo, base, head } = fixtureRepo({ "pay.ts": "export const pay = 1;\n" }, { "pay.ts": "export const pay = () => charge();\n" });
  const remote = mkdtempSync(join(tmpdir(), "viva-remote-"));
  let server = serve({ fetch: createApp(new MockProvider()).fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const port = address.port;
  const env = { ...process.env, VIVA_LLM: "mock", VIVA_PORT: String(port), VIVA_REPO: repo, CI: "1" };
  const git = (...args: string[]) => exec("git", args, { cwd: repo, env, timeout: 10_000 });
  const stop = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  try {
    await git("init", "--bare", "-q", remote);
    await git("remote", "add", "origin", remote);
    await git("push", "-q", "origin", `${base}:refs/heads/main`);
    await git("branch", "--set-upstream-to=origin/main");
    await exec(process.execPath, ["--import", "tsx", cli, "hook", "install"], { env, timeout: 10_000 });

    const started = Date.now();
    const blocked = await git("push").catch((error: { code: number; stderr: string }) => error);
    expect(blocked).toHaveProperty("code", 1);
    expect(blocked.stderr).toContain("exam required; push blocked");
    expect(Date.now() - started).toBeLessThan(8_000);
    expect((await git("ls-remote", "origin", "refs/heads/main")).stdout).toContain(base);
    const url = `http://127.0.0.1:${port}/v1`;
    const reviews = await (await fetch(`${url}/reviews`)).json() as unknown[];
    const review = Review.parse(reviews[0]);
    const response = await fetch(`${url}/reviews/${review.id}/answers`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(review.plan!.questions.map((q) => ({ questionId: q.id, mode: "typed", transcript: "The behaviour now charges." }))),
    });
    expect(Review.parse(await response.json()).gate?.reason).toBe("exam-passed");
    await stop();
    server = serve({ fetch: createApp(new MockProvider()).fetch, port, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const retry = await git("push");
    expect(retry.stdout).toContain("exam-passed");
    expect(retry.stderr).not.toContain("exam required");
    expect((await git("ls-remote", "origin", "refs/heads/main")).stdout).toContain(head);

    await stop();
    writeFileSync(join(repo, "pay.ts"), "export const pay = () => charge(2);\n");
    await git("add", ".");
    await git("commit", "-qm", "daemon-down");
    const down = await git("push");
    expect(down.stderr).toContain("viva: skipped, daemon unavailable");
    expect((await git("ls-remote", "origin", "refs/heads/main")).stdout).toContain((await git("rev-parse", "HEAD")).stdout.trim());
  } finally {
    if (server.listening) await stop();
    rmSync(repo, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  }
}, 30_000);
