import { readFileSync } from "node:fs";
import type { FileMap } from "@viva/engine";
import type { CheckName, EvalCase, ExpectedClaim } from "./index.js";

/**
 * Real changes from this repo's own history, written by agents in the team's
 * sessions. `before` and `after` are the files as they stood either side of the
 * commit, and git computes the patch. The intent is the commit's own subject line.
 * Each bug is a defect an agent shipped that review later found and fixed, so the
 * expected claim comes from the fix and was fixed before any live run. The clean
 * cases are real commits that changed no behaviour.
 */
interface Snapshot {
  commit: string;
  subject: string;
  before: FileMap;
  after: FileMap;
}

/** A fixture repo cannot commit nothing, so a change that adds files starts from a README both sides share. */
const PLACEHOLDER: FileMap = { "README.md": "# Fixture\n" };

const load = (id: string): Snapshot => {
  const snapshot = JSON.parse(readFileSync(new URL(`./real/${id}.json`, import.meta.url), "utf8")) as Snapshot;
  if (Object.keys(snapshot.before).length > 0) return snapshot;
  return { ...snapshot, before: PLACEHOLDER, after: { ...PLACEHOLDER, ...snapshot.after } };
};

/** Silent-decision is left out: the intent asked for the feature, so the defect is not an unrequested choice. */
const defect: CheckName[] = ["behaviour-change", "failure-path"];

function realBug(id: string, description: string, file: string, lines: [number, number], concepts: RegExp[]): EvalCase {
  const { subject, before, after } = load(id);
  const expected: ExpectedClaim = { description, file, lines, concepts, checks: defect };
  return { id, intent: subject, before, after, expected };
}

function realClean(id: string, intent?: string): EvalCase {
  const { subject, before, after } = load(id);
  return { id, intent: intent ?? subject, before, after, expected: null };
}

export const realCases: EvalCase[] = [
  realBug("r01-sse-listener-leak",
    "The abort handler is only registered after the first write, so a client that disconnects at once never triggers cleanup, and its listener and the fog timer leak.",
    "apps/vivad/src/app.ts", [194, 200],
    [/\b(abort|disconnect\w*|clos\w*|leav\w*|gone)/i, /\b(leak\w*|never|hang\w*|stuck|not (be )?(removed|cleaned)|remain\w*|clean\w*)/i, /\b(listener|interval|poll\w*|timer|stream)/i]),
  realBug("r02-exam-load-race",
    "Loads are not ordered, so a slow answer for an earlier request can arrive late and replace the exam that is open with a different review.",
    "apps/web/src/exam/ExamRoom.tsx", [15, 20],
    [/\b(race|out[- ]of[- ]order|stale|older|late|overwrit\w*|swap\w*|replac\w*)/i, /\b(response|request|load\w*|fetch\w*|poll\w*|review)/i, /\b(another|different|newer|latest|open|exam|answers?|questions?)/i]),
  realBug("r03-skip-overwritten",
    "A poll that was already in flight can land after the skip and replace the skipped review with the older, unskipped one.",
    "apps/web/src/exam/ExamRoom.tsx", [42, 52],
    [/\b(poll\w*|watch\w*|reload\w*|refetch\w*|load\w*|race|concurrent|in[- ]flight)/i, /\b(skip\w*|review|gate|result)/i, /\b(overwrit\w*|replac\w*|revert\w*|undo\w*|clobber\w*|lose|lost|stale|older)/i]),
  realBug("r04-ledger-date",
    "A ledger row with an unreadable date is accepted, so any later date arithmetic on it gives NaN.",
    "packages/engine/src/ledger/notes.ts", [20, 25],
    [/\b(date|time\w*|timestamp)/i, /\b(invalid|unreadable|malformed|nan|unparsable|unparseable|bad|not (a )?valid)/i, /\b(ledger|attestation|row|mastery|fog|entr\w*)/i]),
  realBug("r05-treemap-weights",
    "A NaN, infinite or negative weight is not handled, so Math.max propagates NaN and every tile's size becomes NaN.",
    "apps/web/src/fog/treemap.ts", [57, 62],
    [/\b(nan|non-?finite|infinit\w*|invalid|negative|bad|missing)/i, /\bweights?\b/i, /\b(layout|tiles?|map|treemap|rect\w*|area|size)/i]),
  realBug("r06-symlink-memory",
    "The memory folder is created before it is checked for symlinks, so a symlinked .viva makes Viva create folders outside the repo.",
    "packages/engine/src/memory/store.ts", [142, 145],
    [/\b(symlink\w*|link\w*)/i, /\b(mkdir|creat\w*|before|order|first)/i, /\b(outside|escap\w*|travers\w*|repo|memory (folder|root)|\.viva)/i]),
  realClean("r07-clean-split-modules"),
  realClean("r08-clean-act-tests"),
  realClean("r09-clean-test-fog-poll"),
  realClean("r10-clean-test-wait"),
];

export const realIds: readonly string[] = realCases.map((c) => c.id);
