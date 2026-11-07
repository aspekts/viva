import { Attestation } from "@viva/contracts";
import { git } from "../sources/git.js";
import { withLedgerLock } from "./lock.js";

export const NOTES_REF = "refs/notes/viva";

/** Ledger entries live in git notes, so they travel with the repo and need no server. */
export async function readLedger(repoPath: string): Promise<Attestation[]> {
  let listing: string;
  try {
    listing = await git(repoPath, ["notes", "--ref", NOTES_REF, "list"]);
  } catch {
    return [];
  }
  const entries: Attestation[] = [];
  for (const line of listing.split("\n").filter(Boolean)) {
    const object = line.split(" ")[1];
    if (!object) continue;
    const body = await git(repoPath, ["notes", "--ref", NOTES_REF, "show", object]);
    for (const row of body.split("\n").filter(Boolean)) {
      try {
        const parsed = Attestation.safeParse(JSON.parse(row));
        if (parsed.success) entries.push(parsed.data);
      } catch { /* Union notes may contain malformed lines from another clone. */ }
    }
  }
  return entries;
}

export async function appendAttestations(repoPath: string, commit: string, rows: Attestation[]): Promise<void> {
  if (rows.length === 0) return;
  await withLedgerLock(repoPath, () => git(repoPath, ["notes", "--ref", NOTES_REF, "append", "-F", "-", commit], rows.map((r) => JSON.stringify(r)).join("\n")));
}
