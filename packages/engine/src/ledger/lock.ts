import { realpath } from "node:fs/promises";
import { git } from "../sources/git.js";

const pending = new Map<string, Promise<unknown>>();
const syncing = new Map<string, Promise<unknown>>();

/** Notes writes and merges share a queue, including across linked worktrees. */
export function withLedgerLock<T>(repoPath: string, work: () => Promise<T>): Promise<T> {
  return queued(repoPath, work, pending);
}

/** Network operations queue separately so local appends never wait on transport. */
export function withLedgerSyncLock<T>(repoPath: string, work: () => Promise<T>): Promise<T> {
  return queued(repoPath, work, syncing);
}

async function queued<T>(repoPath: string, work: () => Promise<T>, queue: Map<string, Promise<unknown>>): Promise<T> {
  const key = await realpath((await git(repoPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim());
  const previous = queue.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  queue.set(key, next);
  try { return await next; }
  finally { if (queue.get(key) === next) queue.delete(key); }
}
