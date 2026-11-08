/**
 * Builds the demo repo: a small shop whose payment webhook an agent "adds retries" to,
 * quietly moving the duplicate check after the charge. Pushing it runs a Viva exam.
 *
 *   pnpm demo [dir]     defaults to ../viva-demo-shop, next to this repo. Rebuilds it if present.
 *
 * Plain Node and git, so it runs the same on macOS, Windows and Linux.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VIVA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = resolve(process.argv[2] ?? join(VIVA_ROOT, "..", "viva-demo-shop"));
const ORIGIN = `${DIR}-origin.git`;

const run = (cmd: string, args: string[], cwd = DIR, env: NodeJS.ProcessEnv = {}) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, shell: cmd === "pnpm" && process.platform === "win32" }).trim();
const git = (...args: string[]) => run("git", args);

function write(files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(DIR, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function commit(message: string) {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

const BEFORE = {
  "package.json": `{
  "name": "corner-shop",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
`,
  "README.md": `# Corner Shop

Checkout for a small online shop. The card gateway calls \`handleWebhook\` when an order is paid.
Gateways deliver events at least once, so the same event can arrive twice.
`,
  "src/payments.js": `/** Talks to the card gateway. A slow gateway can time out after the card was charged. */
export async function chargeCard(order, gateway) {
  const result = await gateway.charge({ amount: order.total, currency: order.currency, card: order.card });
  if (!result.ok) throw new Error(\`charge failed: \${result.reason}\`);
  return { id: result.id, amount: order.total };
}
`,
  "src/store.js": `/** Remembers which gateway events have been handled. In production this is a database table. */
export function createStore() {
  const processed = new Set();
  return {
    async hasProcessed(eventId) {
      return processed.has(eventId);
    },
    async markProcessed(eventId) {
      processed.add(eventId);
    },
  };
}
`,
  "src/webhook.js": `import { chargeCard } from "./payments.js";

/** Handles a paid-order event. The same event can be delivered more than once. */
export async function handleWebhook(event, { store, gateway }) {
  if (await store.hasProcessed(event.id)) return { status: "duplicate" };
  await store.markProcessed(event.id);

  const receipt = await chargeCard(event.order, gateway);
  return { status: "charged", receipt };
}
`,
  "test/webhook.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebhook } from "../src/webhook.js";
import { createStore } from "../src/store.js";

const order = { total: 4200, currency: "GBP", card: "tok_visa" };
const okGateway = () => ({ charges: 0, async charge() { this.charges += 1; return { ok: true, id: \`ch_\${this.charges}\` }; } });

test("charges a paid order", async () => {
  const gateway = okGateway();
  const result = await handleWebhook({ id: "evt_1", order }, { store: createStore(), gateway });
  assert.equal(result.status, "charged");
  assert.equal(gateway.charges, 1);
});
`,
};

const AFTER = {
  "src/retry.js": `/** Retries a flaky call with a short backoff. */
export async function withRetry(fn, { attempts = 3, delayMs = 200 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastError;
}
`,
  "src/webhook.js": `import { chargeCard } from "./payments.js";
import { withRetry } from "./retry.js";

/** Handles a paid-order event. The same event can be delivered more than once. */
export async function handleWebhook(event, { store, gateway, retry = {} }) {
  const receipt = await withRetry(() => chargeCard(event.order, gateway), retry);

  if (await store.hasProcessed(event.id)) return { status: "duplicate" };
  await store.markProcessed(event.id);
  return { status: "charged", receipt };
}
`,
  "test/retry.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../src/retry.js";

test("retries until the call succeeds", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("gateway timeout");
    return "ok";
  }, { delayMs: 1 });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("gives up after the last attempt", async () => {
  await assert.rejects(withRetry(async () => { throw new Error("down"); }, { attempts: 2, delayMs: 1 }), /down/);
});
`,
};

for (const path of [DIR, ORIGIN]) if (existsSync(path)) rmSync(path, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
run("git", ["init", "-q", "--bare", "-b", "main", ORIGIN], VIVA_ROOT);

git("init", "-q", "-b", "main");
git("remote", "add", "origin", ORIGIN);
// A fresh machine may have no git identity, and git refuses to commit without one.
for (const [key, fallback] of [["user.name", "Viva Demo"], ["user.email", "demo@viva.local"]] as const) {
  try {
    git("config", key);
  } catch {
    git("config", key, fallback);
  }
}
write(BEFORE);
commit("Handle paid-order webhooks from the card gateway");
git("push", "-q", "-u", "origin", "main");

run("pnpm", ["--silent", "--dir", VIVA_ROOT, "viva", "hook", "install"], DIR, { VIVA_REPO: DIR });

write(AFTER);
commit("Add retries to the payment webhook\n\nThe card gateway sometimes times out. Retry the charge up to three times.");

console.log(`Demo repo ready: ${DIR}

  1. Start Viva:  pnpm dev            (in ${VIVA_ROOT})
  2. Push:        cd "${DIR}" && git push

The unpushed commit adds retries, and silently moves the duplicate check after the charge.
Run pnpm demo again to reset it.`);
