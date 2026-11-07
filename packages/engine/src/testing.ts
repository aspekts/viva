import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type FileMap = Record<string, string>;

function write(repo: string, files: FileMap) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

/** Builds a throwaway repo with one commit before and one after a change. */
export function fixtureRepo(before: FileMap, after: FileMap) {
  const repo = mkdtempSync(join(tmpdir(), "viva-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Test");
  run("config", "user.email", "test@example.com");
  write(repo, before);
  run("add", ".");
  run("commit", "-q", "-m", "before");
  const base = run("rev-parse", "HEAD");
  write(repo, after);
  run("add", ".");
  run("commit", "-q", "-m", "after");
  return { repo, base, head: run("rev-parse", "HEAD") };
}
