import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { type Attestation, FogMap, Review } from "@viva/contracts";
import { appendAttestations, computeFog, fixtureRepo, loadFogFiles, MockProvider, readLedger, syncLedger } from "@viva/engine";
import { createApp } from "./app.js";

// Put another real client's push precisely between fetch and push, without sleeps.
const race = vi.hoisted(() => ({ beforePush: undefined as (() => Promise<void>) | undefined }));
vi.mock("node:util", async (original) => {
  const actual = await original<typeof import("node:util")>();
  const { execFile } = await import("node:child_process");
  return { ...actual, promisify: (fn: Parameters<typeof actual.promisify>[0]) => {
    const run = actual.promisify(fn);
    if (fn !== execFile) return run;
    return async (...args: unknown[]) => {
      if ((args[1] as string[])[0] === "push" && race.beforePush) {
        const callback = race.beforePush;
        race.beforePush = undefined;
        await callback();
      }
      return Reflect.apply(run, undefined, args);
    };
  } };
});

const dirs: string[] = [];
afterEach(async () => {
  race.beforePush = undefined;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })));
});
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sync = (repo: string, push = true) => syncLedger(repo, { push, timeoutMs: 10_000 });
async function team() {
  const seed = fixtureRepo({ "pay.ts": "export function pay() { return 1; }\n" }, { "pay.ts": "export function pay() { charge(); return 1; }\n" });
  dirs.push(seed.repo);
  const root = await mkdtemp(join(tmpdir(), "viva-team-"));
  dirs.push(root);
  const remote = join(root, "remote.git");
  git(root, "init", "--bare", remote);
  git(seed.repo, "remote", "add", "origin", remote);
  git(seed.repo, "push", "origin", "main");
  const a = join(root, "a"), b = join(root, "b");
  for (const repo of [a, b]) {
    git(root, "clone", "--branch", "main", remote, repo);
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.com");
  }
  const row = (person: string): Attestation => ({ person, file: "pay.ts", symbol: "pay", codeHash: git(a, "rev-parse", "HEAD:pay.ts"), score: 1, at: new Date().toISOString(), reviewId: person });
  return { a, b, remote, root, base: seed.base, head: seed.head, row };
}

it("a passed viva in clone A clears Fog in clone B after pull and Fog load", async () => {
  const { a, b, base, head } = await team();
  const files = await loadFogFiles(b);
  expect(computeFog(files, await readLedger(b), new Date()).nodes[0]?.fog).toBe(1);
  const app = createApp(new MockProvider());
  const response = await app.request("/v1/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repoPath: a, base, head, person: "Alice" }) });
  const review = Review.parse(await response.json());
  expect(review.stage).toBe("awaiting-exam");
  const answer = await app.request(`/v1/reviews/${review.id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(review.plan!.questions.map((q) => ({ questionId: q.id, transcript: "The behaviour now charges first.", mode: "typed" }))) });
  expect(Review.parse(await answer.json()).gate?.reason).toBe("exam-passed");
  // Queue a fetch-only operation behind background publication; the test does not publish.
  expect(await sync(a, false)).toBe(true);
  git(b, "pull", "--ff-only");
  const map = FogMap.parse(await (await app.request(`/v1/fog?repo=${encodeURIComponent(b)}`)).json());
  expect(map.nodes[0]?.fog).toBeLessThan(0.3);
  expect(map.nodes[0]?.knownBy[0]?.person).toBe("Alice");
});

it("unions concurrent appends on the same commit, deduplicating repeated syncs", async () => {
  const { a, b, head, row } = await team();
  const rows = [row("Alice"), row("Bob")];
  await appendAttestations(a, head, [rows[0]!]);
  await appendAttestations(b, head, [rows[1]!]);
  expect(await sync(a)).toBe(true);
  expect(await sync(b)).toBe(true);
  expect(await sync(a)).toBe(true);
  expect(await sync(b)).toBe(true);
  for (const repo of [a, b]) expect(await readLedger(repo)).toEqual(expect.arrayContaining(rows));
  expect(await readLedger(b)).toHaveLength(2);
});

it("recovers a rejected non-fast-forward notes push by fetching, merging and retrying", async () => {
  const { a, b, head, row } = await team();
  await appendAttestations(a, head, [row("Alice")]);
  await appendAttestations(b, head, [row("Bob")]);
  race.beforePush = async () => { expect(await sync(b)).toBe(true); };
  expect(await sync(a)).toBe(true);
  expect(await sync(b, false)).toBe(true);
  expect((await readLedger(b)).map((r) => r.person).sort()).toEqual(["Alice", "Bob"]);
});

it("fails open without a remote or with an unreachable remote and keeps local notes", async () => {
  const { a, head, row, root } = await team();
  const entry = row("Alice");
  await appendAttestations(a, head, [entry]);
  git(a, "remote", "remove", "origin");
  expect(await sync(a)).toBe(false);
  git(a, "remote", "add", "origin", join(root, "missing.git"));
  expect(await sync(a)).toBe(false);
  expect(await syncLedger(a, { timeoutMs: 0 })).toBe(false);
  expect(await readLedger(a)).toEqual([entry]);
});

it("bypasses pre-push for notes publication and never follows unrelated tags", async () => {
  const { a, remote, head, row } = await team();
  const hook = join(a, ".git", "hooks", "pre-push");
  await writeFile(hook, '#!/usr/bin/env node\nprocess.stderr.write("gate was entered\\n"); process.exit(1);\n');
  await chmod(hook, 0o755);
  git(a, "config", "push.followTags", "true");
  git(a, "tag", "-a", "private-tag", "-m", "Unrelated local tag");
  await appendAttestations(a, head, [row("Alice")]);
  expect(() => git(a, "push", "origin", "refs/notes/viva")).toThrow();
  expect(await sync(a)).toBe(true);
  expect(git(remote, "for-each-ref", "--format=%(refname)", "refs/tags")).toBe("");
});

it("bounds a stalled network request and leaves the ledger readable", async () => {
  const { a, head, row } = await team();
  await appendAttestations(a, head, [row("Alice")]);
  const server = createServer(() => { /* Deliberately never respond. */ });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    git(a, "remote", "set-url", "origin", `http://127.0.0.1:${address.port}/stalled.git`);
    const started = Date.now();
    expect(await syncLedger(a, { timeoutMs: 250 })).toBe(false);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await readLedger(a)).toHaveLength(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
