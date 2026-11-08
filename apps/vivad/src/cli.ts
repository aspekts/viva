import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Review } from "@viva/contracts";
import { allowsPush, readMemory, syncLedger } from "@viva/engine";
import open from "open";
import { ApiError, DaemonClient, SubmissionTimeoutError } from "./client.js";
import { runExam } from "./exam.js";
import { formatFeedback, handToAgent } from "./feedback.js";
import { formatMemory, formatSaved, repoRelative } from "./memory.js";
import { controllingTerminal, pushContext } from "./terminal.js";

const WEB = process.env.VIVA_WEB ?? "http://localhost:5173";
/** The AnimePix buddy site, opened for high-risk pushes. VIVA_BUDDY=off opens the exam room instead. */
const BUDDY = process.env.VIVA_BUDDY === "off" ? null : (process.env.VIVA_BUDDY ?? "http://localhost:5174");
const reviewLink = (site: string, id: string) => `${site}/?review=${encodeURIComponent(id)}`;

async function openInBrowser(link: string): Promise<void> {
  try { await open(link, { wait: false }); } catch { /* The printed link remains usable. */ }
}
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

/** Who is pushing. Without a git user.name, fall back to the OS account rather than skipping the gate. */
function pushPerson(): string {
  try {
    const name = git("config", "user.name");
    if (name) return name;
  } catch {
    // Unset: use the OS account.
  }
  return userInfo().username;
}

/** With no agent session, the pushed commit messages are the closest thing to a stated intent. */
function commitIntent(base: string): string | undefined {
  try {
    return git("log", "--format=%B", `${base}..HEAD`).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function presentReview(review: Review, client: DaemonClient, preferTerminal = false): Promise<number> {
  const context = pushContext(process.env, !!(process.stderr.isTTY || process.stdout.isTTY));
  if (review.stage === "awaiting-exam") {
    // Desktop pushes go to the site; explicit `viva exam` and remote terminals keep Ink.
    const input = context.terminal && (preferTerminal || !context.openBrowser) ? controllingTerminal() : null;
    if (input) {
      const output = process.stderr.isTTY ? process.stderr : process.stdout;
      const completed = await runExam(review, client, input, output);
      if (!completed) {
        console.error(`viva: exam left unfinished; push blocked. Run pnpm viva exam ${review.id}, then git push again.`);
        return 1;
      }
      review = completed;
    } else {
      const link = reviewLink(BUDDY ?? WEB, review.id);
      console.error(`viva: exam required; push blocked. Complete ${link} or run pnpm viva exam ${review.id} in a terminal, then git push again.`);
      if (BUDDY) console.error(`viva: the full exam room, with the code, is at ${reviewLink(WEB, review.id)}`);
      if (context.openBrowser) await openInBrowser(link);
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
    const link = reviewLink(BUDDY ?? WEB, review.id);
    console.error(`viva: review this push at ${link}`);
    // It must never throw: gate() fails open on unexpected errors, which would let this blocked push through.
    try {
      if (!preferTerminal && context.openBrowser) await openInBrowser(link);
    } catch { /* The printed instructions remain. */ }
  }
  return allowsPush(review.gate) ? 0 : 1;
}

export async function gate(client = new DaemonClient()): Promise<number> {
  let review: Review;
  try {
    const base = pushBase();
    const request = {
      repoPath: git("rev-parse", "--show-toplevel"),
      base,
      head: git("rev-parse", "HEAD"),
      person: pushPerson(),
      intent: commitIntent(base),
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
  if (!input) return presentReview(review, client, true);
  const completed = await runExam(review, client, input, process.stderr.isTTY ? process.stderr : process.stdout);
  return completed ? presentReview(completed, client, true) : 1;
}

/** Appends to the hook, as core.hooksPath would bypass Entire's hooks. */
function installHook(): number {
  const path = resolve(REPO, git("rev-parse", "--git-path", "hooks"), "pre-push");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "#!/bin/sh\n";
  const legacy = `VIVA_REPO="$(pwd)" pnpm --silent --dir "${VIVA_ROOT}" viva gate || exit $?`;
  const quotedRoot = `'${VIVA_ROOT.replaceAll("'", "'\"'\"'")}'`;
  // Corepack selects pnpm from cwd before pnpm handles --dir. Preserve the pushed
  // repo, then enter Viva's workspace so another project's pnpm version cannot win.
  const command = `(export VIVA_REPO="$(pwd)"; cd ${quotedRoot} || exit 0; pnpm --silent viva gate) || exit $?`;
  if (existing.includes(MARKER)) {
    if (existing.includes(legacy)) {
      writeFileSync(path, existing.replace(legacy, command));
      chmodSync(path, 0o755);
      console.log(`viva: updated ${path}`);
      return 0;
    }
    console.log("viva: hook already installed");
    return 0;
  }
  writeFileSync(path, `${existing.trimEnd()}\n\n${MARKER}\n${command}\n`);
  chmodSync(path, 0o755);
  console.log(`viva: installed ${path}`);
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const [command, sub, flag, agent] = args;
  if (command === "gate") return gate();
  if (command === "acp") {
    const { serveAcp } = await import("./acp.js");
    await serveAcp();
    return 0;
  }
  if (command === "hook" && sub === "install") return installHook();
  if (command === "ledger" && sub === "sync") {
    const synced = await syncLedger(REPO);
    console.log(synced ? "viva: ledger synced" : "viva: ledger sync unavailable; local notes retained, retry later");
    return 0;
  }
  if (command === "exam" && sub) return exam(sub);
  if (command === "feedback" && sub) {
    if ((flag && flag !== "--agent") || (flag === "--agent" && agent !== "claude" && agent !== "codex") || args.length > 4) {
      throw new Error("usage: viva feedback <reviewId> [--agent claude|codex]");
    }
    const text = formatFeedback(await new DaemonClient().feedback(sub));
    console.log(text);
    return agent === "claude" || agent === "codex" ? handToAgent(agent, text, REPO) : 0;
  }
  if (command === "remember" && sub && args.length === 2) {
    console.log(formatSaved(await new DaemonClient().saveMemory(sub)));
    return 0;
  }
  if (command === "memory" && sub && args.length === 2) {
    // Reads the files directly, so it works without the daemon, for people and agents alike.
    // Git reports real paths, so resolve symlinks such as macOS's /var -> /private/var first.
    const root = realpathSync(git("rev-parse", "--show-toplevel"));
    const file = repoRelative(root, realpathSync(REPO), sub);
    console.log(formatMemory(file, await readMemory(root, file)));
    return 0;
  }
  console.log("usage: viva gate | viva hook install | viva ledger sync | viva exam <reviewId> | viva feedback <reviewId> [--agent claude|codex] | viva remember <reviewId> | viva memory <file>");
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
