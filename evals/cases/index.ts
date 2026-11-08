import type { FileMap } from "@viva/engine";
import { realCases, realIds } from "./real.js";

export const checkNames = ["behaviour-change", "failure-path", "silent-decision"] as const;
export type CheckName = (typeof checkNames)[number];

/** Fixed before a live run. Every concept must occur in ONE anchored claim. */
export interface ExpectedClaim {
  description: string;
  file: string;
  lines: [number, number];
  concepts: RegExp[];
  checks: CheckName[];
}

/** Lines the intent asked for: a claim here must say "requested", or stay quiet. */
export interface RequestedRegion {
  file: string;
  lines: [number, number];
}

export interface EvalCase {
  id: string;
  intent: string;
  before: FileMap;
  after: FileMap;
  expected: ExpectedClaim | null;
  requested?: RequestedRegion;
  gate?: "docs-only";
}

const behaviour: CheckName[] = ["behaviour-change", "silent-decision"];
const failure: CheckName[] = [...behaviour, "failure-path"];

function bug(
  id: string, intent: string, file: string, before: string, after: string,
  description: string, lines: [number, number], concepts: RegExp[], checks = behaviour,
): EvalCase {
  return { id, intent, before: { [file]: before }, after: { [file]: after }, expected: { description, file, lines, concepts, checks } };
}

// Hand-written source snapshots: git computes the actual patch, never a model.
const seeded: EvalCase[] = [
  bug("01-page-boundary", "Rename the output accumulator for readability.", "src/pages.ts",
    `export function pages(rows: string[], size: number) {
  const result = [];
  for (let end = size; end <= rows.length; end += size) {
    result.push(rows.slice(end - size, end));
  }
  return result;
}
`, `export function pages(rows: string[], size: number) {
  const batches = [];
  for (let end = size; end < rows.length; end += size) {
    batches.push(rows.slice(end - size, end));
  }
  return batches;
}
`, "The strict boundary drops the final full page when row count is a multiple of size.", [3, 4],
    [/\b(page|batch|rows?|chunk)/i, /\b(last|final|exact|multiple|equal)/i, /\b(drop\w*|skip\w*|omit\w*|exclud\w*|miss\w*|not processed)/i]),

  bug("02-flipped-access", "Extract the permission predicate into a named local.", "auth/access.py",
    `def can_publish(user, document):
    return user.is_editor and not document.locked
`, `def can_publish(user, document):
    permitted = user.is_editor and document.locked
    return permitted
`, "Editors can publish locked documents and cannot publish unlocked documents.", [2, 2],
    [/\block\w*/i, /\b(allow\w*|permit\w*|publish\w*|grant\w*)/i, /\b(invert\w*|flip\w*|instead|only|now|revers\w*)/i]),

  bug("03-null-customer", "Use a local for the customer name.", "src/receipt.kt",
    `fun greeting(order: Order): String {
    return order.customer?.name ?: "Guest"
}
`, `fun greeting(order: Order): String {
    val name = order.customer!!.name
    return name
}
`, "An order without a customer now throws instead of greeting Guest.", [2, 3],
    [/\b(customer|null)/i, /\b(throw\w*|crash\w*|exception|dereferenc\w*)/i], failure),

  bug("04-side-effect-order", "Rename the receipt local; preserve payment behaviour.", "payments/capture.go",
    `func Capture(card Card) (Receipt, error) {
    if err := Validate(card); err != nil { return Receipt{}, err }
    receipt, err := Charge(card)
    return receipt, err
}
`, `func Capture(card Card) (Receipt, error) {
    captured, err := Charge(card)
    if err != nil { return Receipt{}, err }
    if err := Validate(card); err != nil { return Receipt{}, err }
    return captured, nil
}
`, "Charge runs before validation, so invalid cards can be charged before rejection.", [2, 4],
    [/\bcharg\w*/i, /\b(validat\w*|invalid)/i, /\b(before|prior|order|already)/i], failure),

  bug("05-changed-default", "Centralize the environment lookup without changing defaults.", "config/cache.rb",
    `def cache_enabled?(env)
  env.fetch("CACHE_ENABLED", "false") == "true"
end
`, `def cache_enabled?(env)
  value = env.fetch("CACHE_ENABLED", "true")
  value == "true"
end
`, "Caching becomes enabled by default when CACHE_ENABLED is absent.", [2, 3],
    [/\bcach\w*/i, /\b(default|absent|unset|missing|not set)/i, /\b(enabl\w*|true|on)/i]),

  bug("06-removed-validation", "Simplify the transfer handler; keep its input contract.", "src/transfer.rs",
    `fn transfer(amount: i64) -> Result<(), Error> {
    if amount <= 0 { return Err(Error::InvalidAmount); }
    debit(amount)?;
    credit(amount)
}
`, `fn transfer(amount: i64) -> Result<(), Error> {
    debit(amount)?;
    credit(amount)
}
`, "Zero and negative amounts now reach debit/credit because the positive-amount guard is removed.", [1, 3],
    [/\b(amount|debit|credit)/i, /\b(negative|zero|non.?positive|<=\s*0|invalid)/i, /\b(remov\w*|allow\w*|accept\w*|no longer|without|reach\w*|validat\w*)/i], failure),

  bug("07-swallowed-error", "Reduce nesting in the configuration loader.", "src/config.cs",
    `Config Load(string path) {
    try { return Parse(File.ReadAllText(path)); }
    catch (IOException) { throw; }
}
`, `Config Load(string path) {
    try { return Parse(File.ReadAllText(path)); }
    catch (IOException) { return new Config(); }
}
`, "I/O failures are swallowed and return an empty default configuration instead of propagating.", [3, 3],
    [/\b(ioexception|i\/o|io error|read\w*|file)/i, /\b(default|empty|new config)/i, /\b(swallow\w*|suppress\w*|hid\w*|mask\w*|instead|no longer)/i], failure),

  bug("08-timeout-unit", "Express the timeout with a named unit constant.", "client/request.py",
    `def fetch(client, url):
    return client.get(url, timeout=2)
`, `SECONDS_PER_MINUTE = 60

def fetch(client, url):
    return client.get(url, timeout=2 * SECONDS_PER_MINUTE)
`, "The request timeout grows from 2 seconds to 120 seconds, delaying failure detection.", [4, 4],
    [/\btimeout/i, /\b(120|two minutes|2 minutes|60.?fold|sixty)/i, /\b(increas\w*|long\w*|delay\w*|extend\w*|from|now)/i], failure),

  bug("09-retry-attempts", "Name the retry budget and retain the current retry policy.", "client/retry.ts",
    `export async function fetchWithRetry(send: () => Promise<string>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await send(); }
    catch (error) { if (attempt === 2) throw error; }
  }
}
`, `const MAX_ATTEMPTS = 1;
export async function fetchWithRetry(send: () => Promise<string>) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try { return await send(); }
    catch (error) { if (attempt === MAX_ATTEMPTS - 1) throw error; }
  }
}
`, "The retry budget drops from three attempts to one, eliminating retries on transient errors.", [1, 5],
    [/\b(retr\w*|attempt\w*)/i, /\b(one|single|1)/i, /\b(eliminat\w*|disabl\w*|reduc\w*|no retr\w*|remov\w*|instead|from)/i], failure),

  bug("10-silent-dependency", "Keep the existing ID format; extract the ID creation into its own function.", "src/ids.ts",
    `export function createId(): string {
  return crypto.randomUUID();
}
`, `import { v4 as uuid } from "uuid";

export function createId(): string {
  return uuid();
}
`, "ID generation silently adds a runtime dependency on the external uuid package.", [1, 4],
    [/\buuid/i, /\b(dependency|dependenc\w*|external|third.party|package)/i, /\b(add\w*|new|introduc\w*|requir\w*|now|switch\w*)/i], ["silent-decision"]),

  bug("11-buried-invoice", "Standardize invoice row formatting and add a CSV header, keeping totals unchanged.", "billing/export.py",
    `from decimal import Decimal

def format_money(value):
    return f"{value:.2f}"

def export_invoices(invoices):
    rows = []
    for invoice in invoices:
        subtotal = sum(item.price * item.quantity for item in invoice.items)
        tax = subtotal * invoice.tax_rate
        total = subtotal + tax - invoice.discount
        rows.append(",".join([invoice.id, format_money(subtotal), format_money(tax), format_money(total)]))
    return "\\n".join(rows)
`, `from decimal import Decimal

CSV_COLUMNS = ("id", "subtotal", "tax", "total")

def money_cell(value):
    formatted = f"{value:.2f}"
    return formatted

def csv_row(cells):
    return ",".join(str(cell) for cell in cells)

def export_invoices(invoices):
    rows = [csv_row(CSV_COLUMNS)]
    for invoice in invoices:
        subtotal = sum(
            item.price * item.quantity
            for item in invoice.items
        )
        tax = subtotal * invoice.tax_rate
        total = subtotal + tax + invoice.discount
        cells = (
            invoice.id,
            money_cell(subtotal),
            money_cell(tax),
            money_cell(total),
        )
        rows.append(csv_row(cells))
    return "\\n".join(rows)
`, "The discount is added rather than subtracted, increasing invoice totals.", [20, 20],
    [/\bdiscount/i, /\b(add\w*|increas\w*|infl\w*|plus)/i, /\b(subtract\w*|deduct\w*|instead|rather)/i]),

  bug("12-buried-tenant-scope", "Reformat the query and extract row mapping, preserving which invoices are returned.", "db/invoices.sql",
    `-- $1 is the current tenant; $2 is the minimum invoice date.
SELECT id, total, created_at
FROM invoices
WHERE tenant_id = $1 AND created_at >= $2 AND deleted_at IS NULL
ORDER BY created_at DESC;
`, `-- $1 is the current tenant; $2 is the minimum invoice date.
WITH formatted AS (
    SELECT
        id,
        tenant_id,
        total,
        created_at,
        deleted_at
    FROM invoices
)
SELECT
    id,
    total,
    created_at
FROM formatted
WHERE
    tenant_id = $1
    OR created_at >= $2
    AND deleted_at IS NULL
ORDER BY
    created_at DESC;
`, "Changing tenant/date AND to OR admits other tenants' invoices and bypasses the date/deletion filters for the current tenant.", [17, 19],
    [/\btenant/i, /\b(or|disjunct\w*)/i, /\b(other|cross|leak\w*|bypass\w*|all|any)/i]),

  {
    id: "13-clean-guard", intent: "Use an early return while preserving visibility rules.",
    before: { "ui/visible.ts": `export function visible(user: User | null) {
  if (user !== null) { return user.active && !user.hidden; }
  return false;
}
` },
    after: { "ui/visible.ts": `export function visible(user: User | null) {
  if (user === null) return false;
  return user.active && !user.hidden;
}
` }, expected: null,
  },
  {
    id: "14-clean-retry-rename", intent: "Rename attempt to index, preserving retry count and error propagation.",
    before: { "client/send.py": `def send_with_retry(send):
    for attempt in range(3):
        try:
            return send()
        except OSError:
            if attempt == 2:
                raise
` },
    after: { "client/send.py": `def send_with_retry(send):
    for index in range(3):
        try:
            return send()
        except OSError:
            if index == 2:
                raise
` }, expected: null,
  },
  {
    id: "15-clean-default-extract", intent: "Name the default timeout constant, preserving the 2000 millisecond timeout.",
    before: { "client/options.go": `func DefaultOptions() Options {
    return Options{Timeout: 2000 * time.Millisecond}
}
` },
    after: { "client/options.go": `const defaultTimeout = 2000 * time.Millisecond

func DefaultOptions() Options {
    return Options{Timeout: defaultTimeout}
}
` }, expected: null,
  },
  {
    id: "16-clean-sql-layout", intent: "Lay out the query over multiple lines without changing its predicates.",
    before: { "db/active.sql": `SELECT id FROM users WHERE active = TRUE AND deleted_at IS NULL ORDER BY id;
` },
    after: { "db/active.sql": `SELECT id
FROM users
WHERE active = TRUE
  AND deleted_at IS NULL
ORDER BY id;
` }, expected: null,
  },
];

/** A seeded diff under a new intent that asks for it. Nothing in the code differs. */
function reuse(from: string, id: string, intent: string, lines: [number, number]): EvalCase[] {
  const source = seeded.find((c) => c.id === from)!;
  return [{ ...source, id, intent, expected: null, requested: { file: source.expected!.file, lines } }];
}

export const cases: EvalCase[] = [
  ...seeded,

  // The same diffs as 05, 09 and 08, but the intent asks for them, so only the intent can separate the origins.
  ...reuse("05-changed-default", "18-requested-default",
    "Turn caching on by default; setting CACHE_ENABLED=false should still turn it off.", [2, 3]),
  ...reuse("09-retry-attempts", "19-requested-retry",
    "Stop retrying in fetchWithRetry: make one attempt and let callers handle the failure.", [1, 5]),
  ...reuse("08-timeout-unit", "20-requested-timeout",
    "Raise the request timeout to two minutes because slow report endpoints keep timing out.", [1, 4]),
  {
    id: "21-requested-status", intent: "Return 404 instead of 403 for hidden profiles so we don't reveal that they exist.",
    before: { "api/profile.ts": `export function profileResponse(viewer: User, profile: Profile) {
  if (profile.hidden && viewer.id !== profile.ownerId) {
    return { status: 403, body: "forbidden" };
  }
  return { status: 200, body: profile };
}
` },
    after: { "api/profile.ts": `export function profileResponse(viewer: User, profile: Profile) {
  if (profile.hidden && viewer.id !== profile.ownerId) {
    return { status: 404, body: "not found" };
  }
  return { status: 200, body: profile };
}
` }, expected: null, requested: { file: "api/profile.ts", lines: [2, 4] },
  },
  {
    ...bug("22-mixed-upload-limit", "Add a per-user rate limit to the upload handler.", "api/upload.ts",
      `const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function upload(user: User, file: File) {
  if (file.size > MAX_UPLOAD_BYTES) return { status: 413 };
  await store.put(user.id, file);
  return { status: 201 };
}
`, `import { limiter } from "./limiter";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function upload(user: User, file: File) {
  if (!limiter.allow(user.id)) return { status: 429 };
  if (file.size > MAX_UPLOAD_BYTES) return { status: 413 };
  await store.put(user.id, file);
  return { status: 201 };
}
`, "The maximum upload size rises from 10 MB to 100 MB, which the rate limit request never mentioned.", [3, 3],
      [/\b(upload|size|bytes|file)/i, /\b(100|ten.?fold|10x|10 ?times|increas\w*|rais\w*|larger)/i, /\b(limit|max\w*|cap)/i]),
    requested: { file: "api/upload.ts", lines: [6, 6] },
  },
  {
    ...bug("23-mixed-login-lockout", "Add structured logging to the login handler.", "auth/login.py",
      `def login(user, password):
    if user.failed_attempts >= 5:
        raise AccountLocked(user.id)
    if not verify(password, user.password_hash):
        user.failed_attempts += 1
        raise InvalidCredentials()
    user.failed_attempts = 0
    return create_session(user)
`, `import logging

logger = logging.getLogger(__name__)

def login(user, password):
    logger.info("login attempt", extra={"user_id": user.id})
    if not verify(password, user.password_hash):
        user.failed_attempts += 1
        logger.warning("login failed", extra={"user_id": user.id})
        raise InvalidCredentials()
    user.failed_attempts = 0
    logger.info("login succeeded", extra={"user_id": user.id})
    return create_session(user)
`, "The account lockout after five failed attempts is removed, which the logging request never mentioned.", [5, 7],
      [/\b(lock\w*|failed.attempts|brute\w*)/i, /\b(remov\w*|no longer|dropp\w*|delet\w*|without|never|bypass\w*)/i], failure),
    requested: { file: "auth/login.py", lines: [12, 12] },
  },
  bug("24-subtle-dropped-await", "Clean up deleteAccount; behaviour should stay the same.", "accounts/delete.ts",
    `export async function deleteAccount(id: string) {
  await audit.record("account.delete", id);
  await accounts.remove(id);
}
`, `export async function deleteAccount(id: string) {
  audit.record("account.delete", id);
  await accounts.remove(id);
}
`, "The audit write is no longer awaited, so a failed audit no longer stops the deletion.", [2, 2],
    [/\baudit\w*/i, /\b(await\w*|fire.and.forget|not wait\w*|without wait\w*|no longer wait\w*)/i], failure),

  bug("25-subtle-falsy-fallback", "Use a local for the page size.", "src/paging.js",
    `export function pageSize(options) {
  return options.limit ?? 50;
}
`, `export function pageSize(options) {
  const limit = options.limit || 50;
  return limit;
}
`, "An explicit limit of zero now becomes 50, because || falls back on any falsy value.", [2, 3],
    [/\b(zero|0|falsy)/i, /\b(50|default|fallback|fall|replac\w*|instead|treat\w*)/i]),

  {
    id: "26-clean-extract-helper", intent: "Extract the subtotal calculation into a helper.",
    before: { "orders/summary.ts": `export function summary(order: Order) {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * order.taxRate;
  return { subtotal, tax, total: subtotal + tax };
}
` },
    after: { "orders/summary.ts": `function subtotalOf(items: Item[]) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function summary(order: Order) {
  const subtotal = subtotalOf(order.items);
  const tax = subtotal * order.taxRate;
  return { subtotal, tax, total: subtotal + tax };
}
` }, expected: null,
  },
  {
    id: "27-clean-test-added", intent: "Add a test for spaces in slugs.",
    before: { "src/slug.test.ts": `import { slug } from "./slug";

it("lowercases", () => {
  expect(slug("Hello")).toBe("hello");
});
` },
    after: { "src/slug.test.ts": `import { slug } from "./slug";

it("lowercases", () => {
  expect(slug("Hello")).toBe("hello");
});

it("replaces spaces", () => {
  expect(slug("Hello World")).toBe("hello-world");
});
` }, expected: null,
  },
  {
    id: "28-clean-rename-param", intent: "Rename the token parameter and document the method.",
    before: { "auth/Tokens.java": `public boolean isExpired(Token t, Instant now) {
    if (t == null) {
        return true;
    }
    return t.expiresAt().isBefore(now);
}
` },
    after: { "auth/Tokens.java": `/** Returns true when the token is missing or past its expiry. */
public boolean isExpired(Token token, Instant now) {
    if (token == null) {
        return true;
    }
    return token.expiresAt().isBefore(now);
}
` }, expected: null,
  },
  {
    id: "17-clean-docs", intent: "Explain the retry policy in the README.",
    before: { "README.md": "# Client\n\nSend a request.\n" },
    after: { "README.md": "# Client\n\nRequests retry at most twice after the initial attempt.\n" },
    expected: null, gate: "docs-only",
  },
];

/** Fixed before any tuning run. Prompts are never tuned against these cases. */
export const holdoutIds: readonly string[] = [
  "08-timeout-unit", "12-buried-tenant-scope", "14-clean-retry-rename", "20-requested-timeout",
  "21-requested-status", "23-mixed-login-lockout", "25-subtle-falsy-fallback", "28-clean-rename-param",
];

export { realIds };

// A real package manifest accompanies the dependency fixture. No install occurs.
const dependency = cases.find((c) => c.id === "10-silent-dependency")!;
dependency.before["package.json"] = '{"private":true,"dependencies":{}}\n';
dependency.after["package.json"] = '{"private":true,"dependencies":{"uuid":"11.1.0"}}\n';

// Real agent changes from the team's own history. They never join the tune or holdout splits.
cases.push(...realCases);
