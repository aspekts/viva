import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withLedgerLock, withLedgerSyncLock } from "./lock.js";
import { NOTES_REF } from "./notes.js";

const exec = promisify(execFile);
// Never fetch directly onto local notes: divergent histories must be unioned.
const TRACKING_REF = "refs/viva/remotes/origin";
class NetworkDeadline extends Error {}

/** Best effort, origin-only transport. No Git output (which can contain data) is logged. */
export async function syncLedger(repoPath: string, { push = true, timeoutMs = 20_000 } = {}): Promise<boolean> {
  try {
    return await withLedgerSyncLock(repoPath, async () => {
      const local = async (...args: string[]) => (await exec("git", args, {
        cwd: repoPath, maxBuffer: 1024 * 1024,
      })).stdout.trim();
      await local("remote", "get-url", "origin");
      const sshCommand = await local("config", "--get", "core.sshCommand").catch(() => "");
      const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
      if (env.GIT_SSH_COMMAND === undefined && env.GIT_SSH === undefined && !sshCommand) {
        env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=10";
      }
      // Only network time consumes this budget; never interrupt a local notes merge.
      let remaining = timeoutMs;
      const network = async (...args: string[]) => {
        if (remaining <= 0) throw new NetworkDeadline();
        const started = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // execFile's timeout alone may leave SSH/helper pipes open on Windows.
          return await Promise.race([
            exec("git", args, { cwd: repoPath, timeout: remaining, maxBuffer: 1024 * 1024, env }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new NetworkDeadline()), remaining);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          remaining -= Date.now() - started;
        }
      };
      const fetchAndMerge = async () => {
        await network("fetch", "--no-tags", "--recurse-submodules=no", "--no-write-fetch-head", "origin", `+${NOTES_REF}:${TRACKING_REF}`);
        await withLedgerLock(repoPath, () => local("notes", "--ref", NOTES_REF, "merge", "-s", "cat_sort_uniq", TRACKING_REF));
      };
      // A new remote may have no notes yet. A failed fetch must not erase local notes.
      try { await fetchAndMerge(); } catch (error) {
        if (error instanceof NetworkDeadline || !push) return false;
      }
      if (!push) return true;
      if (!await local("for-each-ref", "--format=%(objectname)", NOTES_REF)) return true;
      const publish = () => network("push", "--no-verify", "--no-follow-tags", "--recurse-submodules=no", "origin", `${NOTES_REF}:${NOTES_REF}`);
      try { await publish(); }
      catch (error) {
        if (error instanceof NetworkDeadline) return false;
        // Another laptop won the race. Merge its entries and retry exactly once.
        await fetchAndMerge();
        await publish();
      }
      return true;
    });
  } catch { return false; }
}
