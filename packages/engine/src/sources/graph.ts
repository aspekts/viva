import { git } from "./git.js";

export interface BlastRadiusSource {
  /** Number of other places that depend on these symbols or this file. */
  measure(repoPath: string, head: string, symbols: string[], file: string): Promise<number>;
}

/** Works without Entire. TODO(marcus): prefer entire-graph once it can be scripted. */
export const grepBlastRadius: BlastRadiusSource = {
  async measure(repoPath, head, symbols, file) {
    const terms = symbols.length ? symbols : [file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file];
    let count = 0;
    for (const term of terms) {
      try {
        const out = await git(repoPath, ["grep", "-l", "-F", "-e", term, head]);
        count += out.split("\n").filter((l) => l && !l.endsWith(`:${file}`)).length;
      } catch {
        // git grep exits non-zero when nothing matches.
      }
    }
    return count;
  },
};
