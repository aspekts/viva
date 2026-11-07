import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Review } from "@viva/contracts";
import { allowsPush } from "@viva/engine";
import open from "open";
import { ApiError, DaemonClient, SubmissionTimeoutError } from "./client.js";
import { runExam } from "./exam.js";
import { formatFeedback, handToAgent } from "./feedback.js";
import { controllingTerminal, pushContext } from "./terminal.js";

const WEB = process.env.VIVA_WEB ?? "http://localhost:5173";
const MARKER = "# viva gate";

const VIVA_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url))).replaceAll("\\", "/");
/** The repo being pushed. Set by the hook, as pnpm --dir changes the working directory. */
const REPO = process.env.VIVA_REPO ?? process.cwd();

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function pushBase(): string {
  for (const ref of ["@{upstream}", "origin/main", "main"]) {
    try {
      return git("merge-base", ref, "HEAD");
    } catch {
      // Try the next candidate.
    }
  }
  return "HEAD~1";
}

export async function presentReview(review: Review, client: DaemonClient): Promise<number> {
  const context = pushContext(process.env, !!(process.stderr.isTTY || process.stdout.isTTY));
  if (review.stage === "awaiting-exam") {
    const input = context.terminal ? controllingTerminal() : null;
    if (input) {
      const output = process.stderr.isTTY ? process.stderr : process.stdout;
      const completed = await runExam(review, client, input, output);
      if (!completed) {
        console.error(`viva: exam left unfinished; push blocked. Run pnpm viva exam ${review.id}, then git push again.`);
        return 1;
      }
      review = completed;
    } else {
      const link = `${WEB}/?review=${encodeURIComponent(review.id)}`;
      console.error(`viva: exam required; push blocked. Complete ${link} or run pnpm viva exam ${review.id} in a terminal, then git push again.`);
      if (context.openBrowser) {
        try { await open(link, { wait: false }); } catch { /* The printed link remains usable. */ }
      }
      return 1;
    }
  }
  if (!review.gate) {
    console.error("viva: review is incomplete; retry git push");
    return 1;
  }
  console.log(`viva: ${review.gate.verdict} (${review.gate.reason})`);
  if (!allowsPush(review.gate)) {
    console.error(`viva: push blocked. Run pnpm viva feedback ${review.id} for missed concepts.${review.gate.skippable ? ` Run pnpm viva exam ${review.id} to review the verdict or skip with debt.` : " Hard gate: resolve the flagged change; this cannot be skipped."}`);
  }
  return allowsPush(review.gate) ? 0 : 1;
}

export async function gate(client = new DaemonClient()): Promise<number> {
  let review: Review;
  try {
    const request = {
      repoPath: git("rev-parse", "--show-toplevel"),
      base: pushBase(),
      head: git("rev-parse", "HEAD"),
      person: git("config", "user.name"),
    };

    review = await client.start(request);
  } catch {
    // Preserve the hook's fail-open policy for every review-creation failure.
    console.warn("viva: skipped, daemon unavailable or review infrastructure failed");
    return 0;
  }
  try {
    return await presentReview(review, client);
  } catch (error) {
    if (error instanceof SubmissionTimeoutError || (error instanceof ApiError && error.status < 500)) {
      console.error(`viva: push blocked (${error.message}); retry git push to refresh the review`);
      return 1;
    }
    // Fail open: a broken or absent daemon must never stop a push.
    console.warn("viva: skipped, daemon unavailable or review infrastructure failed");
    return 0;
  }
}

async function exam(id: string): Promise<number> {
  const client = new DaemonClient();
  const review = await client.review(id);
  const context = pushContext(process.env, !!(process.stderr.isTTY || process.stdout.isTTY));
  const input = context.terminal ? controllingTerminal() : null;
  if (!input) return presentReview(review, client);
  const completed = await runExam(review, client, input, process.stderr.isTTY ? process.stderr : process.stdout);
  return completed ? presentReview(completed, client) : 1;
}

/** Appends to the hook, as core.hooksPath would bypass Entire's hooks. */
function installHook(): number {
  const path = resolve(REPO, git("rev-parse", "--git-path", "hooks"), "pre-push");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "#!/bin/sh\n";
  if (existing.includes(MARKER)) {
    console.log("viva: hook already installed");
    return 0;
  }
  writeFileSync(path, `${existing.trimEnd()}\n\n${MARKER}\nVIVA_REPO="$(pwd)" pnpm --silent --dir "${VIVA_ROOT}" viva gate || exit $?\n`);
  chmodSync(path, 0o755);
  console.log(`viva: installed ${path}`);
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [command, sub, flag, agent] = args;
  if (command === "gate") return gate();
  if (command === "hook" && sub === "install") return installHook();
  if (command === "exam" && sub) return exam(sub);
  if (command === "feedback" && sub) {
    if ((flag && flag !== "--agent") || (flag === "--agent" && agent !== "claude" && agent !== "codex") || args.length > 4) {
      throw new Error("usage: viva feedback <reviewId> [--agent claude|codex]");
    }
    const text = formatFeedback(await new DaemonClient().feedback(sub));
    console.log(text);
    return agent === "claude" || agent === "codex" ? handToAgent(agent, text, REPO) : 0;
  }
  console.log("usage: viva gate | viva hook install | viva exam <reviewId> | viva feedback <reviewId> [--agent claude|codex]");
  return command ? 1 : 0;
}

/** Resolve both sides, including macOS /tmp and symlinked checkouts. */
export function isEntrypoint(argvPath: string | undefined, moduleUrl = import.meta.url): boolean {
  if (!argvPath) return false;
  const canonical = (path: string) => {
    try { return realpathSync(path); } catch { return resolve(path); }
  };
  return canonical(argvPath) === canonical(fileURLToPath(moduleUrl));
}

if (isEntrypoint(process.argv[1])) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`viva: ${(error as Error).message}`); process.exitCode = 1; }
}
