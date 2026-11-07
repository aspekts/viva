import { realpath } from "node:fs/promises";
import { git } from "../sources/git.js";

const pending = new Map<string, Promise<unknown>>();

/** Notes writes and merges share a queue, including across linked worktrees. */
export async function withLedgerLock<T>(repoPath: string, work: () => Promise<T>): Promise<T> {
  const key = await realpath((await git(repoPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim());
  const previous = pending.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  pending.set(key, next);
  try { return await next; }
  finally { if (pending.get(key) === next) pending.delete(key); }
}
