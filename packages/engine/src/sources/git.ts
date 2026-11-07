import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export async function git(repoPath: string, args: string[], input?: string): Promise<string> {
  if (input === undefined) {
    const { stdout } = await exec("git", args, { cwd: repoPath, maxBuffer: MAX_BUFFER });
    return stdout;
  }
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd: repoPath, maxBuffer: MAX_BUFFER }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
    child.stdin?.end(input);
  });
}

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
}

export interface Change {
  diff: string;
  files: ChangedFile[];
  totalLines: number;
}

export async function loadChange(repoPath: string, base: string, head: string): Promise<Change> {
  const range = `${base}...${head}`;
  const numstat = await git(repoPath, ["diff", "--numstat", range]);
  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added = "0", removed = "0", ...path] = line.split("\t");
      return { path: path.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
    });
  const diff = await git(repoPath, ["diff", "--unified=5", range]);
  return { diff, files, totalLines: files.reduce((sum, f) => sum + f.added + f.removed, 0) };
}

/**
 * Models miscount lines in a raw diff, so print each new-file line's number after
 * its marker. Tracks hunk sizes, so a code line that looks like a header stays code.
 */
export function numberDiff(diff: string): string {
  let oldLeft = 0;
  let newLeft = 0;
  let line = 0;
  return diff
    .split("\n")
    .map((raw) => {
      if (oldLeft > 0 || newLeft > 0) {
        const marker = raw[0];
        if (marker === "\\") return raw;
        if (marker === "-") {
          oldLeft -= 1;
          return `-${" ".repeat(String(line).length)}|${raw.slice(1)}`;
        }
        newLeft -= 1;
        if (marker !== "+") oldLeft -= 1;
        line += 1;
        return `${marker === "+" ? "+" : " "}${line - 1}|${raw.slice(1)}`;
      }
      const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (hunk) {
        oldLeft = Number(hunk[1] ?? 1);
        line = Number(hunk[2]);
        newLeft = Number(hunk[3] ?? 1);
      }
      return raw;
    })
    .join("\n");
}

/** Identifies a file's exact content, so understanding can expire when it changes. */
export async function blobHash(repoPath: string, ref: string, path: string): Promise<string> {
  return (await git(repoPath, ["rev-parse", `${ref}:${path}`])).trim();
}
