import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withLedgerLock } from "./lock.js";
import { NOTES_REF } from "./notes.js";

const exec = promisify(execFile);
// Never fetch directly onto local notes: divergent histories must be unioned.
const TRACKING_REF = "refs/viva/remotes/origin";

/** Best effort, origin-only transport. No Git output (which can contain data) is logged. */
export async function syncLedger(repoPath: string, { push = true, timeoutMs = 1500 } = {}): Promise<boolean> {
  try {
    return await withLedgerLock(repoPath, async () => {
      const deadline = Date.now() + timeoutMs;
      const run = async (...args: string[]) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("ledger sync timed out");
        const { stdout } = await exec("git", args, {
          cwd: repoPath, timeout: remaining, maxBuffer: 1024 * 1024,
          env: {
            ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never",
            GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes -o ConnectTimeout=1",
          },
        });
        return stdout.trim();
      };
      await run("remote", "get-url", "origin");
      const fetchAndMerge = async () => {
        await run("fetch", "--no-tags", "--recurse-submodules=no", "--no-write-fetch-head", "origin", `+${NOTES_REF}:${TRACKING_REF}`);
        await run("notes", "--ref", NOTES_REF, "merge", "-s", "cat_sort_uniq", TRACKING_REF);
      };
      // A new remote may have no notes yet. A failed fetch must not erase local notes.
      try { await fetchAndMerge(); } catch { if (!push) return false; }
      if (!push) return true;
      const local = await run("for-each-ref", "--format=%(objectname)", NOTES_REF);
      if (!local) return true;
      const publish = () => run("push", "--no-verify", "--no-follow-tags", "origin", `${NOTES_REF}:${NOTES_REF}`);
      try { await publish(); }
      catch {
        // Another laptop won the race. Merge its entries and retry exactly once.
        await fetchAndMerge();
        await publish();
      }
      return true;
    });
  } catch { return false; }
}
