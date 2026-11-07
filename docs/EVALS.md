# Live check evals

## Recorded run

The single live run stopped on the first HTTP 429 (case 06, silent-decision),
without retrying that request or making further API calls. Seventeen cells returned
schema-valid results; the eighteenth was rate-limited. Only five bug cases were
fully evaluated; a sixth had two completed cells. **Clean-code false-positive rate
and the larger buried-diff cases remain unmeasured.** The recall below is the fixed
lexical rubric's score, not a manual judgment of the model's prose.

- Date (UTC): 2026-11-07T19:12:15.566Z
- Provider: gemini; configured model: gemini-3.5-flash-lite
- Run complete: **no — do not treat missing observations as model successes**
- Full-corpus detection lower bound (any check finds the expected claim; unmeasured cases remain in denominator): **5/12 (41.7%)**
- Recall on fully observed bug cases: **4/5 (80.0%)**
- False-positive rate (any claim on fully observed clean code cases): **n/a (0 observations)**
- Sequential check latency: **15835 ms** total; 880 ms mean per attempted cell
- Check calls attempted: 18 (provider may retry transient non-429 failures); reported tokens: **5621 input / 1333 output**
- Failed requests have unknown token usage, not an observed zero. Output tokens are Gemini's candidatesTokenCount; internal thinking tokens are not included.

| Check | Full-corpus detection lower bound | Recall on observed target cells | Clean-code false-positive rate |
| --- | --- | --- | --- |
| behaviour-change | 5/11 (45.5%) | 5/6 (83.3%) | n/a (0 observations) |
| failure-path | 0/6 (0.0%) | 0/3 (0.0%) | n/a (0 observations) |
| silent-decision | 1/12 (8.3%) | 1/5 (20.0%) | n/a (0 observations) |

## Check-by-case matrix

| Case | behaviour-change | failure-path | silent-decision | Latency ms | Tokens in / out |
| --- | --- | --- | --- | ---: | ---: |
| 01-page-boundary | HIT | CLEAR | MISS | 3056 | 1163 / 234 |
| 02-flipped-access | MISS | CLEAR | MISS | 2532 | 926 / 200 |
| 03-null-customer | HIT | MISS | MISS | 2328 | 917 / 210 |
| 04-side-effect-order | HIT | MISS | MISS | 3182 | 1052 / 360 |
| 05-changed-default | HIT | CLEAR | HIT | 2383 | 956 / 237 |
| 06-removed-validation | HIT | MISS | ERROR | 2354 | 607 / 92 |
| 07-swallowed-error | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 08-timeout-unit | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 09-retry-attempts | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 10-silent-dependency | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 11-buried-invoice | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 12-buried-tenant-scope | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 13-clean-guard | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 14-clean-retry-rename | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 15-clean-default-extract | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 16-clean-sql-layout | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |
| 17-clean-docs | NOT-RUN | NOT-RUN | NOT-RUN | 0 | 0 / 0 |

HIT = anchored expected claim found; MISS = expected claim not matched (even if another claim exists); CLEAR = no claim expected or emitted; FP = clean code flagged; EXTRA = off-scope check emitted a claim on a bug case; GATE = deterministic bypass; ERROR / NOT-RUN = unmeasured. EXTRA is reported but excluded from the clean-case FP denominator.

## Every failure / unexpected finding

- **01-page-boundary / silent-decision: MISS**; 1 claims.
- **02-flipped-access / behaviour-change: MISS**; 1 claims.
- **02-flipped-access / silent-decision: MISS**; 1 claims.
- **03-null-customer / failure-path: MISS**; 0 claims.
- **03-null-customer / silent-decision: MISS**; 1 claims.
- **04-side-effect-order / failure-path: MISS**; 1 claims.
- **04-side-effect-order / silent-decision: MISS**; 1 claims.
- **06-removed-validation / failure-path: MISS**; 0 claims.
- **06-removed-validation / silent-decision: ERROR**; 0 claims. Error: Gemini returned 429.
- **07-swallowed-error / behaviour-change: NOT-RUN**; 0 claims.
- **07-swallowed-error / failure-path: NOT-RUN**; 0 claims.
- **07-swallowed-error / silent-decision: NOT-RUN**; 0 claims.
- **08-timeout-unit / behaviour-change: NOT-RUN**; 0 claims.
- **08-timeout-unit / failure-path: NOT-RUN**; 0 claims.
- **08-timeout-unit / silent-decision: NOT-RUN**; 0 claims.
- **09-retry-attempts / behaviour-change: NOT-RUN**; 0 claims.
- **09-retry-attempts / failure-path: NOT-RUN**; 0 claims.
- **09-retry-attempts / silent-decision: NOT-RUN**; 0 claims.
- **10-silent-dependency / behaviour-change: NOT-RUN**; 0 claims.
- **10-silent-dependency / failure-path: NOT-RUN**; 0 claims.
- **10-silent-dependency / silent-decision: NOT-RUN**; 0 claims.
- **11-buried-invoice / behaviour-change: NOT-RUN**; 0 claims.
- **11-buried-invoice / failure-path: NOT-RUN**; 0 claims.
- **11-buried-invoice / silent-decision: NOT-RUN**; 0 claims.
- **12-buried-tenant-scope / behaviour-change: NOT-RUN**; 0 claims.
- **12-buried-tenant-scope / failure-path: NOT-RUN**; 0 claims.
- **12-buried-tenant-scope / silent-decision: NOT-RUN**; 0 claims.
- **13-clean-guard / behaviour-change: NOT-RUN**; 0 claims.
- **13-clean-guard / failure-path: NOT-RUN**; 0 claims.
- **13-clean-guard / silent-decision: NOT-RUN**; 0 claims.
- **14-clean-retry-rename / behaviour-change: NOT-RUN**; 0 claims.
- **14-clean-retry-rename / failure-path: NOT-RUN**; 0 claims.
- **14-clean-retry-rename / silent-decision: NOT-RUN**; 0 claims.
- **15-clean-default-extract / behaviour-change: NOT-RUN**; 0 claims.
- **15-clean-default-extract / failure-path: NOT-RUN**; 0 claims.
- **15-clean-default-extract / silent-decision: NOT-RUN**; 0 claims.
- **16-clean-sql-layout / behaviour-change: NOT-RUN**; 0 claims.
- **16-clean-sql-layout / failure-path: NOT-RUN**; 0 claims.
- **16-clean-sql-layout / silent-decision: NOT-RUN**; 0 claims.
- **17-clean-docs / behaviour-change: NOT-RUN**; 0 claims.
- **17-clean-docs / failure-path: NOT-RUN**; 0 claims.
- **17-clean-docs / silent-decision: NOT-RUN**; 0 claims.

## Fixed case rubric

- **01-page-boundary**: The strict boundary drops the final full page when row count is a multiple of size. Anchor: `src/pages.ts:3-4`; target checks: behaviour-change, silent-decision. Required concept groups: `/\b(page|batch|rows?|chunk)/i` AND `/\b(last|final|exact|multiple|equal)/i` AND `/\b(drop\w*|skip\w*|omit\w*|exclud\w*|miss\w*|not processed)/i`.
- **02-flipped-access**: Editors can publish locked documents and cannot publish unlocked documents. Anchor: `auth/access.py:2-2`; target checks: behaviour-change, silent-decision. Required concept groups: `/\block\w*/i` AND `/\b(allow\w*|permit\w*|publish\w*|grant\w*)/i` AND `/\b(invert\w*|flip\w*|instead|only|now|revers\w*)/i`.
- **03-null-customer**: An order without a customer now throws instead of greeting Guest. Anchor: `src/receipt.kt:2-3`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\b(customer|null)/i` AND `/\b(throw\w*|crash\w*|exception|dereferenc\w*)/i`.
- **04-side-effect-order**: Charge runs before validation, so invalid cards can be charged before rejection. Anchor: `payments/capture.go:2-4`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\bcharg\w*/i` AND `/\b(validat\w*|invalid)/i` AND `/\b(before|prior|order|already)/i`.
- **05-changed-default**: Caching becomes enabled by default when CACHE_ENABLED is absent. Anchor: `config/cache.rb:2-3`; target checks: behaviour-change, silent-decision. Required concept groups: `/\bcach\w*/i` AND `/\b(default|absent|unset|missing|not set)/i` AND `/\b(enabl\w*|true|on)/i`.
- **06-removed-validation**: Zero and negative amounts now reach debit/credit because the positive-amount guard is removed. Anchor: `src/transfer.rs:1-3`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\b(amount|debit|credit)/i` AND `/\b(negative|zero|non.?positive|<=\s*0|invalid)/i` AND `/\b(remov\w*|allow\w*|accept\w*|no longer|without|reach\w*|validat\w*)/i`.
- **07-swallowed-error**: I/O failures are swallowed and return an empty default configuration instead of propagating. Anchor: `src/config.cs:3-3`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\b(ioexception|i\/o|io error|read\w*|file)/i` AND `/\b(default|empty|new config)/i` AND `/\b(swallow\w*|suppress\w*|hid\w*|mask\w*|instead|no longer)/i`.
- **08-timeout-unit**: The request timeout grows from 2 seconds to 120 seconds, delaying failure detection. Anchor: `client/request.py:4-4`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\btimeout/i` AND `/\b(120|two minutes|2 minutes|60.?fold|sixty)/i` AND `/\b(increas\w*|long\w*|delay\w*|extend\w*|from|now)/i`.
- **09-retry-attempts**: The retry budget drops from three attempts to one, eliminating retries on transient errors. Anchor: `client/retry.ts:1-5`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\b(retr\w*|attempt\w*)/i` AND `/\b(one|single|1)/i` AND `/\b(eliminat\w*|disabl\w*|reduc\w*|no retr\w*|remov\w*|instead|from)/i`.
- **10-silent-dependency**: ID generation silently adds a runtime dependency on the external uuid package. Anchor: `src/ids.ts:1-4`; target checks: silent-decision. Required concept groups: `/\buuid/i` AND `/\b(dependency|dependenc\w*|external|third.party|package)/i` AND `/\b(add\w*|new|introduc\w*|requir\w*|now|switch\w*)/i`.
- **11-buried-invoice**: The discount is added rather than subtracted, increasing invoice totals. Anchor: `billing/export.py:20-20`; target checks: behaviour-change, silent-decision. Required concept groups: `/\bdiscount/i` AND `/\b(add\w*|increas\w*|infl\w*|plus)/i` AND `/\b(subtract\w*|deduct\w*|instead|rather)/i`.
- **12-buried-tenant-scope**: Changing tenant/date AND to OR admits other tenants' invoices and bypasses the date/deletion filters for the current tenant. Anchor: `db/invoices.sql:17-19`; target checks: behaviour-change, silent-decision. Required concept groups: `/\btenant/i` AND `/\b(or|disjunct\w*)/i` AND `/\b(other|cross|leak\w*|bypass\w*|all|any)/i`.
- **13-clean-guard**: Clean refactor; every check must return zero claims.
- **14-clean-retry-rename**: Clean refactor; every check must return zero claims.
- **15-clean-default-extract**: Clean refactor; every check must return zero claims.
- **16-clean-sql-layout**: Clean refactor; every check must return zero claims.
- **17-clean-docs**: Docs-only; must bypass all model checks.

## Method and reproduction

- `pnpm evals` stays offline: the original six pipeline smoke cases assert deterministic mock behaviour; this matrix also runs with MockProvider, whose scores are NOT model-quality evidence. Mock matrix scores do not gate CI.
- Run `pnpm evals:live --report docs/EVALS.md` to explicitly use Gemini. Loads root .env (existing environment wins); skips successfully without GEMINI_API_KEY. GEMINI_MODEL defaults to gemini-3.5-flash-lite. No fallback model is used, keeping attribution unambiguous.
- Each cell calls production runChecks with exactly one unchanged check markdown prompt and the production zod schema/untrusted wrappers. Checks and cases are sequential. The first 429 stops the entire run, without retrying the 429 or falling back. Deterministic prechecks and injection scan run first; docs bypass is excluded from model clean-case metrics.
- Fixtures are hand-written before/after files committed to temporary Git repositories; production loadChange generates the diff. Repositories are removed afterwards. No code from fixtures is installed or executed.
- The hand-authored expected claim/rubric is never sent to the model. One claim must overlap the fixed file/line anchor and match ALL concept regexes in its summary/evidence; silent-decision must also label it silent. No model grades another model.
- This lexical score is reproducible but can reject correct paraphrases and accept sufficiently similar incorrect prose. It measures seeded claim detection, not exam-question usefulness, correctness of all extra claims, or end-to-end planning/risk thresholds. One small, single-run corpus is not a general accuracy estimate. No check prompts were tuned for this run.
- Only score/count/timing metadata and hashes are retained. No raw model output, repository diffs, transcripts, API error bodies, or secrets are logged or stored in this report.

## Provenance (SHA-256)

Check prompt hashes:

- behaviour-change: 1756f405df4f7df052338a3845b8bacb385d8a9dc1ae65b70058cb0f69c297a3
- failure-path: ec984d4cf9e31b852bfde00fd3ef62f559727eed28a51a21f6441466669de8ce
- silent-decision: 8b8f36386357525c4ec2573b99bdd06237fcc05bea4bc55157af71c3935fc231

| Case | Fixture + rubric hash | Per-check output hashes (matrix order; — means no parsed output) |
| --- | --- | --- |
| 01-page-boundary | b5f8b20f49bae8164f3abcf1260a8682ec6d0dd55171ab04a0244fe1cabbe62f | 7e9e7f0868fab2d5f66f2c5c935fdac700d59dfc81773f7b1519600dd6cd4aaf / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / a170f2062568a81b7267456b0bc77586393c77fea831a5be748c59c606c5f559 |
| 02-flipped-access | 8c41c178185b25c3ceff0a2222964435da7de2568e54a782496cfc10fc8b92e7 | 827143a0f0b13dfcf1066d50c773f1b58cfa0a8c64a354e26648f6a192949740 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / a69f3b1ac82ad15cef2b095dd37a051d4a57c860b6e6915b4076526d30254d9e |
| 03-null-customer | 69224cecc7e9b77b8130c3593b6748e8866e1988fb0ca4b94e81f5c1b57d12cb | a3ae6d8ad4c1b34367367970cfe09bcdb9a4a5c96f7e91691f38eadf01068342 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 7bb9c3118f8ded556cabc45c4a6b355831f497e9096f9deffe8da712d8bf7b98 |
| 04-side-effect-order | 61272019eaa1151c5f12ad2b76288d1c0a8971561e170b7a6be4c2452885e438 | d5e0c814dd24e15242b71b134a4aab9604459ea25c9806ca7bd53a70dc379672 / 474d539577a034fd70a556ca8554e2fd79197a444ed6e3313facc16fc883bd57 / 3d579cdfd8cd3908578aaa208369f0b2bbac7d1844af31e6f75cf607f5d9d5ac |
| 05-changed-default | f7b999426c3e6d2dccb80dea4848416872b3fc46b3f08315e385050b3bfd963c | 4ef5a1123cb105750a73ce978d37896b054c846c971b2e8e2b1eb3f77198fe70 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / dd25f6c538821090206bdef62c15cb53542601af689bb8faac4ed8d67ea1497d |
| 06-removed-validation | 5c06a6343f53b28d8ce28ca62d99b1b52b416a9dc68ad8d7cdf9af3566951ce3 | eeadcdc6db276221d16b3c928c45b36653c2f6f672562e5bca72590b5bad2357 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / — |
| 07-swallowed-error | 511a60fbf307af793622e40df626591f37c6306ddb1ccf27b57f3fb61fe76508 | — / — / — |
| 08-timeout-unit | ba42e348f6abb762f7e0289f609d32f2252e87e54500e88334c817dcf73d9c53 | — / — / — |
| 09-retry-attempts | 71a7766b081dd6cd235d116b9a6dc945d97584905d3a9d97f802d07e3a63cd7b | — / — / — |
| 10-silent-dependency | 652b4cff8878e3ae35eff804e48d6181f79373362b5c725d95998606a0c66e62 | — / — / — |
| 11-buried-invoice | 83ed3458113158be26b192bc424aee064c29ceefb66d146e71afe15328c0882f | — / — / — |
| 12-buried-tenant-scope | 3d779005643f12fc33185f016f40cb0f317ef4a654eefb761431b04ffe0f13f0 | — / — / — |
| 13-clean-guard | ad4fd960e4b031add17e5690ac87efa739ca4460a95d6c1a3db22e14596a7630 | — / — / — |
| 14-clean-retry-rename | 8a101abfc8f0d5a6b2a75b9227ef6c045c94f8bae426f5d4cc90b575129973ec | — / — / — |
| 15-clean-default-extract | 955530881aa8047a172c1bbc03c6d3891e16c98f322c52bae3679f3f5176bab6 | — / — / — |
| 16-clean-sql-layout | 81fa2e82b5d5ef48d335c38d9673b25499d74b4b4dbc9233798ac92951b43ed7 | — / — / — |
| 17-clean-docs | 03dbe5b39cc4191a2eaa6d630e75f6b9202d427523c103464cbf076696a6250c | — / — / — |
