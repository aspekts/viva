import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ReviewDecision, type ReviewRequest, type Review } from "@viva/contracts";

/** Git's private directory also works for worktrees and nonstandard git dirs. */
export async function decisionIdentity(request: ReviewRequest) {
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: request.repoPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const repoPath = await realpath(git("rev-parse", "--show-toplevel"));
  const canonical = {
    ...request, repoPath,
    base: git("rev-parse", "--verify", `${request.base}^{commit}`),
    head: git("rev-parse", "--verify", `${request.head}^{commit}`),
  };
  const key = createHash("sha256").update(JSON.stringify([
    repoPath, canonical.base, canonical.head, canonical.person, canonical.intent ?? null,
  ])).digest("hex");
  const dir = resolve(repoPath, git("rev-parse", "--git-path", "viva-decisions"));
  return { request: canonical, key, dir };
}

/**
 * Policy 2: before it, an exam plan with no questions could record exam-passed.
 * Policy 3: before it, two questions sharing an ID could pass on one answer, and
 * model-written question text reached the grader unfenced.
 * Older passes are examined again, while older failures and skips still stand.
 */
export const DECISION_POLICY = 3;

export async function readDecision(dir: string, key: string): Promise<ReviewDecision | null> {
  try {
    const receipt = ReviewDecision.parse(JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")));
    if (receipt.key !== key) return null;
    const stalePass = receipt.gate.reason === "exam-passed" && (receipt.policy ?? 1) < DECISION_POLICY;
    return stalePass ? null : receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A damaged cache is an infrastructure error, handled by the fail-open hook.
    throw new Error("could not read local Viva decision");
  }
}

export async function writeDecision(review: Review): Promise<void> {
  if (!review.gate || !review.finishedAt || review.gate.reason === "pipeline-error") return;
  const { dir, key } = await decisionIdentity(review.request);
  const receipt = ReviewDecision.parse({
    key, reviewId: review.id, gate: review.gate, finishedAt: review.finishedAt, policy: DECISION_POLICY,
  });
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `${key}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
  await rename(temporary, join(dir, `${key}.json`));
}
