import type { Attestation, FogMap, FogNode } from "@viva/contracts";
import { defaults, type VivaConfig } from "./config.js";
import { decayedMastery } from "./ledger/mastery.js";
import { git } from "./sources/git.js";

export interface FogFile {
  file: string;
  size: number;
  blastRadius: number;
  hash: string | null;
}

/** fog = 1 - the best mastery anyone on the team holds. */
export function computeFog(files: FogFile[], ledger: Attestation[], now: Date, config: VivaConfig = defaults): FogMap {
  const nodes: FogNode[] = files.map(({ file, size, blastRadius, hash }) => {
    const best = new Map<string, number>();
    for (const a of ledger.filter((entry) => entry.file === file)) {
      best.set(a.person, Math.max(best.get(a.person) ?? 0, decayedMastery(a, hash, now, config)));
    }
    const knownBy = [...best].map(([person, mastery]) => ({ person, mastery }));
    const fog = 1 - Math.max(0, ...knownBy.map((k) => k.mastery));
    return { id: file, file, symbol: null, size, blastRadius, fog, knownBy };
  });
  const debt = nodes.reduce((sum, n) => sum + n.fog * n.size * (1 + Math.log1p(n.blastRadius)), 0);
  return { generatedAt: now.toISOString(), debt, nodes };
}

/** File-level map for now. TODO(marcus): use symbols and blast radius from entire-graph. */
export async function loadFogFiles(repoPath: string): Promise<FogFile[]> {
  const tree = await git(repoPath, ["ls-tree", "-r", "--long", "HEAD"]);
  return tree
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [meta, file] = line.split("\t");
      const [, type, hash, size] = meta?.trim().split(/\s+/) ?? [];
      if (type !== "blob" || !file || /(^|\/)pnpm-lock\.yaml$/.test(file)) return [];
      return [{ file, size: Number(size) || 0, blastRadius: 0, hash: hash ?? null }];
    });
}
