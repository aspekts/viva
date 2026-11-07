import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Review } from "@viva/contracts";
import { allowsPush } from "@viva/engine";

const PORT = process.env.VIVA_PORT ?? "4317";
const API = `http://127.0.0.1:${PORT}/v1`;
const WEB = process.env.VIVA_WEB ?? "http://localhost:5173";
const POLL_MS = 1000;
const EXAM_TIMEOUT_MS = 10 * 60 * 1000;
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

async function gate(): Promise<number> {
  const request = {
    repoPath: git("rev-parse", "--show-toplevel"),
    base: pushBase(),
    head: git("rev-parse", "HEAD"),
    person: git("config", "user.name"),
  };

  let review: Review;
  try {
    const response = await fetch(`${API}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`vivad returned ${response.status}`);
    review = Review.parse(await response.json());
  } catch (error) {
    // Fail open: a broken or absent daemon must never stop a push.
    console.warn(`viva: skipped, daemon unavailable (${(error as Error).message})`);
    return 0;
  }

  if (review.stage === "awaiting-exam") {
    console.log(`viva: this push needs a viva: ${WEB}/?review=${review.id}`);
    const deadline = Date.now() + EXAM_TIMEOUT_MS;
    while (review.stage !== "done" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      review = Review.parse(await (await fetch(`${API}/reviews/${review.id}`)).json());
    }
  }

  if (!review.gate) {
    console.error("viva: exam timed out, push blocked");
    return 1;
  }
  console.log(`viva: ${review.gate.verdict} (${review.gate.reason})`);
  return allowsPush(review.gate) ? 0 : 1;
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

const [command, sub] = process.argv.slice(2);
if (command === "gate") process.exit(await gate());
if (command === "hook" && sub === "install") process.exit(installHook());
console.log("usage: viva gate | viva hook install");
process.exit(command ? 1 : 0);
