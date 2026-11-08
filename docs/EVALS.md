# Live check evals

## Tuning results

All results below came from the live model unless marked. `pnpm check` and CI stay offline.
This is one small corpus of hand-written fixtures, 16 of 27 model-tested cases being bugs, so
read the numbers as direction and not as a general accuracy estimate.

These numbers come from live runs made before this work was re-landed on top of the Entire session
reader and the empty-exam fix, and they were not re-run after. The evals pass no Entire session, so
the reader does not change what the checks see. Two things do differ from those runs: a plan with no
usable questions now fails the review, so `--exam` counts it as an error and not as an exam, and token
estimates use 3.5 characters per token, so offline mock token counts are higher than before.

### Before and after, `gemini-3.5-flash-lite`

The 8 holdout cases were fixed in a commit before any tuning run. Prompts were tuned on the other
19 and frozen before the "after" run. Each column is one run. Before used the unchanged prompts.

| Metric | Tune, before | Tune, after | Holdout, before | Holdout, after |
| --- | ---: | ---: | ---: | ---: |
| Clean changes flagged (lower is better) | 1/5 | 0/5 | 2/2 | 0/2 |
| Bugs found by any check | 10/12 | 12/12 | 1/4 | 3/4 |
| Bugs found and labelled silent by `silent-decision` | 7/12 | 12/12 | 1/4 | 3/4 |
| Requested work handled correctly | 0/3 | 2/3 | 2/3 | 3/3 |
| Matched claims labelled silent | 8/19 | 27/30 | 1/3 | 5/5 |
| Mean slowest check, ms | 1443 | 1150 | 1136 | 1064 |
| Input tokens | 20696 | 29595 | 8725 | 12573 |
| Output tokens | 4459 | 4809 | 1964 | 1420 |

Across all 27 cases, input tokens rose 43% (29421 to 42168), about 157 per check call, from the
shared suffix and line numbers. Output tokens fell 3%.

| Check recall, all cases | Before | After |
| --- | ---: | ---: |
| `silent-decision` | 8/16 | 15/16 |
| `failure-path` | 3/8 | 5/8 |
| `behaviour-change` | 10/15 | 10/15 |

**Noise.** Run-to-run variation is real. The `behaviour-change` and `silent-decision` prompts did
not change between tuning round 1 and the final run, yet 5 of 38 cells changed status. Treat a
difference of one or two cases as noise. The planned holdout repeat was stopped by a 429 after two
cells, so the holdout score has no repeat behind it.

**Still failing.**

- `12-buried-tenant-scope` is the only bug no check matched. It is a holdout case, so its claims
  were not read, and it is unknown whether this is a real miss or a wording miss.
- `22-mixed-upload-limit` / `behaviour-change` called requested work unrequested in the final run.
- Six EXTRA cells remain, mostly `failure-path` reporting normal-path changes. Overlapping claims
  are deduped, so these should not add questions.
- The lexical rubric rejects some correct claims. In tuning round 1 cases 02, 06, 07 and 10 scored
  MISS on claims a reader would accept, such as "library" where the rubric wants `package`. The
  rubric was left alone, so the scores above understate these cells. The final run's text was not
  retained, so this was not re-read for that run.

### What changed

Deterministic fixes came first:

- **Numbered diff lines.** Models miscounted lines in a raw diff, reporting line 18 for a change on
  line 20. Each new-file line now carries its number.
- **`requested` needs an intent.** With no intent and no transcript, `requested` becomes `inferred`,
  because that label lowers risk.
- **Planner output.** One question per real claim, with the location taken from the claim.

Prompt changes:

- **Origin is defined once.** Two checks had no definition and defaulted to `inferred`.
- **A claim names the input, the before and the after.** This removed the no-op claims on clean
  refactors, and made claims say what happens and not what was edited.
- **`failure-path` asks its one question.** "When something goes wrong, does this change what
  happens next?"
- **Spoken questions with full-sentence rubrics.** See below.
- **The grader judges paraphrases.** Outside the planner, in its own commit so it can be dropped.

No case or rubric was weakened. All 17 existing fixture hashes match the live-matrix PR, and 11
cases were added: 4 requested (three reuse a seeded diff with only the intent changed), 2 mixed,
2 subtle, 3 clean.

### Exam questions and grading

`pnpm evals:live --exam` runs the production `startReview`, then grades a right answer and two
wrong ones. The right answer is the case's hand-written description, which is only a proxy: it does
not always answer the question that was asked, so treat "right answers pass" as a lower bound.

| Planner run, 8 tuning cases, same claims | Right answers pass | Wrong answers fail |
| --- | ---: | ---: |
| Old planner, old grader | 1/8 | 8/8 |
| New planner with keyword rubrics, old grader | 2/8 | 8/8 |
| New planner with sentence rubrics, old grader | 3/8 | 8/8 |
| New planner, new grader, plus a confident wrong answer | 5/8 | 8/8 |

| Frozen end-to-end run | Reviews | Clean or requested interrupted | Questions on the seeded change | Rule problems | Right answers pass | Wrong answers fail |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Holdout | 8 | 0/4 | 4/4 | 0/4 questions | 1/4 | 4/4 |
| Tune, stopped by a 429 at case 11 | 9 | not reached | 7/9 | 1/9 questions | 4/7 | 7/7 |

**Rubric gradeability is not solved.** Across the frozen runs, 5/11 right answers passed while all
11 wrong answers failed. The grader is still too strict, so a developer who understands a change
could be sent back. The 1/4 on the holdout is the honest figure, and it is worse than on tuning.

### Latency

Measured end to end through `startReview` on small fixtures, with checks in parallel plus the
planner. Real diffs will be slower.

| Review | n | Median ms | Max ms |
| --- | ---: | ---: | ---: |
| Asks an exam (checks and planner) | 13 | 2337 | 15569 |
| No exam (checks only, holdout) | 4 | 1082 | 1128 |

The 15.6 s review was a single outlier whose cause was not recorded. The 3.4 s figure quoted before
tuning was not re-measured in this harness, so these are not a controlled before and after.

### `gemini-3.5-flash-lite` or `gemini-3.5-flash`

**Not answered.** Flash returned a 429 after 5 completed cells, and again on the first call after a
25-minute cooldown, which suggests a spent quota and not a per-minute limit. Those 5 cells all
scored correctly, as did Flash-Lite's on the same cases, so they show nothing either way.

Keep `gemini-3.5-flash-lite`. It found 15/16 bugs with no false positives, so nothing here makes a
case for a slower, tighter-quota model. The one open question is `12-buried-tenant-scope`. To
settle it, run the full matrix on Flash with a fresh quota and `--pace-ms 15000`. Flash took 48 s
over its 6 attempted calls, but that sample is too small and may include retries, so do not quote it.

### Live usage

About 470 calls in total. A chained script failed to notice the first 429, because the stop only
reached a report file, and about 106 more calls ran, hitting 429s on both models. The runner now
prints the stop and exits with code 75. Tuning read model output for tuning cases only, in a local
script that was not committed.

<!-- Generated by pnpm evals:live --report. Do not edit below this line. -->

## Latest generated run

- Date (UTC): 2026-11-07T20:34:51.612Z
- Provider: gemini; configured model: gemini-3.5-flash-lite
- Run complete: **yes**
- Full-corpus detection lower bound (any check finds the expected claim; unmeasured cases remain in denominator): **15/16 (93.8%)**
- Recall on fully observed bug cases: **15/16 (93.8%)**
- False-positive rate (any claim on fully observed clean code cases): **0/7 (0.0%)**
- Sequential check latency: **79315 ms** total; 979 ms mean per attempted cell
- Check calls attempted: 81 (provider may retry transient non-429 failures); reported tokens: **42168 input / 6229 output**
- Failed requests have unknown token usage, not an observed zero. Output tokens are Gemini's candidatesTokenCount; internal thinking tokens are not included.

| Check | Full-corpus detection lower bound | Recall on observed target cells | Clean-code false-positive rate |
| --- | --- | --- | --- |
| behaviour-change | 10/15 (66.7%) | 10/15 (66.7%) | 0/7 (0.0%) |
| failure-path | 5/8 (62.5%) | 5/8 (62.5%) | 0/7 (0.0%) |
| silent-decision | 15/16 (93.8%) | 15/16 (93.8%) | 0/7 (0.0%) |

| Split | Clean false positives | Recall, any check | Recall, silent-decision | Requested handled correctly | Matched claims labelled silent | Mean slowest cell ms | Tokens in / out |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| tune | 0/5 (0.0%) | 12/12 (100.0%) | 12/12 (100.0%) | 2/3 (66.7%) | 27/30 (90.0%) | 1150 | 29595 / 4809 |
| holdout | 0/2 (0.0%) | 3/4 (75.0%) | 3/4 (75.0%) | 3/3 (100.0%) | 5/5 (100.0%) | 1064 | 12573 / 1420 |

## Check-by-case matrix

| Case | behaviour-change | failure-path | silent-decision | Latency ms | Tokens in / out |
| --- | --- | --- | --- | ---: | ---: |
| 01-page-boundary | HIT | CLEAR | HIT | 2987 | 1635 / 236 |
| 02-flipped-access | HIT | CLEAR | HIT | 2734 | 1362 / 261 |
| 03-null-customer | HIT | HIT | HIT | 3212 | 1359 / 308 |
| 04-side-effect-order | HIT | HIT | HIT | 3328 | 1512 / 344 |
| 05-changed-default | HIT | EXTRA | HIT | 4390 | 1401 / 278 |
| 06-removed-validation | MISS | MISS | HIT | 3290 | 1401 / 326 |
| 07-swallowed-error | MISS | HIT | HIT | 3105 | 1389 / 356 |
| 08-timeout-unit | HIT | MISS | HIT | 2916 | 1410 / 326 |
| 09-retry-attempts | HIT | HIT | HIT | 3148 | 1656 / 463 |
| 10-silent-dependency | EXTRA | EXTRA | HIT | 2812 | 1653 / 320 |
| 11-buried-invoice | HIT | EXTRA | HIT | 3098 | 2517 / 314 |
| 12-buried-tenant-scope | MISS | EXTRA | MISS | 3459 | 1944 / 309 |
| 13-clean-guard | CLEAR | CLEAR | CLEAR | 2370 | 1443 / 18 |
| 14-clean-retry-rename | CLEAR | CLEAR | CLEAR | 2403 | 1476 / 23 |
| 15-clean-default-extract | CLEAR | CLEAR | CLEAR | 2294 | 1440 / 18 |
| 16-clean-sql-layout | CLEAR | CLEAR | CLEAR | 2629 | 1395 / 15 |
| 18-requested-default | CLEAR | CLEAR | CLEAR | 3453 | 1431 / 239 |
| 19-requested-retry | CLEAR | CLEAR | CLEAR | 2877 | 1677 / 326 |
| 20-requested-timeout | CLEAR | CLEAR | CLEAR | 2705 | 1428 / 124 |
| 21-requested-status | CLEAR | CLEAR | CLEAR | 3113 | 1575 / 240 |
| 22-mixed-upload-limit | MISLABEL | EXTRA | HIT | 3521 | 1758 / 551 |
| 23-mixed-login-lockout | MISS | MISS | HIT | 2340 | 1806 / 148 |
| 24-subtle-dropped-await | HIT | HIT | HIT | 2974 | 1401 / 396 |
| 25-subtle-falsy-fallback | HIT | CLEAR | HIT | 2938 | 1359 / 238 |
| 26-clean-extract-helper | CLEAR | CLEAR | CLEAR | 2256 | 1665 / 22 |
| 27-clean-test-added | CLEAR | CLEAR | CLEAR | 2753 | 1500 / 18 |
| 28-clean-rename-param | CLEAR | CLEAR | CLEAR | 2210 | 1575 / 12 |
| 17-clean-docs | GATE | GATE | GATE | 0 | 0 / 0 |

HIT = anchored expected claim found; MISS = expected claim not matched (even if another claim exists); CLEAR = no claim expected or emitted; FP = clean code flagged; EXTRA = off-scope check emitted a claim on a bug case; MISLABEL = requested work reported as silent or inferred; GATE = deterministic bypass; ERROR / NOT-RUN = unmeasured. EXTRA is reported but excluded from the clean-case FP denominator.

## Every failure / unexpected finding

- **05-changed-default / failure-path: EXTRA**; 1 claims.
- **06-removed-validation / behaviour-change: MISS**; 1 claims.
- **06-removed-validation / failure-path: MISS**; 1 claims.
- **07-swallowed-error / behaviour-change: MISS**; 1 claims.
- **08-timeout-unit / failure-path: MISS**; 0 claims.
- **10-silent-dependency / behaviour-change: EXTRA**; 1 claims.
- **10-silent-dependency / failure-path: EXTRA**; 1 claims.
- **11-buried-invoice / failure-path: EXTRA**; 1 claims.
- **12-buried-tenant-scope / behaviour-change: MISS**; 1 claims.
- **12-buried-tenant-scope / failure-path: EXTRA**; 1 claims.
- **12-buried-tenant-scope / silent-decision: MISS**; 1 claims.
- **22-mixed-upload-limit / behaviour-change: MISLABEL**; 2 claims.
- **22-mixed-upload-limit / failure-path: EXTRA**; 1 claims.
- **23-mixed-login-lockout / behaviour-change: MISS**; 0 claims.
- **23-mixed-login-lockout / failure-path: MISS**; 0 claims.

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
- **18-requested-default**: Requested change at `config/cache.rb:2-3`; a claim there must be labelled requested.
- **19-requested-retry**: Requested change at `client/retry.ts:1-5`; a claim there must be labelled requested.
- **20-requested-timeout**: Requested change at `client/request.py:1-4`; a claim there must be labelled requested.
- **21-requested-status**: Requested change at `api/profile.ts:2-4`; a claim there must be labelled requested.
- **22-mixed-upload-limit**: The maximum upload size rises from 10 MB to 100 MB, which the rate limit request never mentioned. Anchor: `api/upload.ts:3-3`; target checks: behaviour-change, silent-decision. Required concept groups: `/\b(upload|size|bytes|file)/i` AND `/\b(100|ten.?fold|10x|10 ?times|increas\w*|rais\w*|larger)/i` AND `/\b(limit|max\w*|cap)/i`. Requested region: `api/upload.ts:6-6`, where a claim must be labelled requested.
- **23-mixed-login-lockout**: The account lockout after five failed attempts is removed, which the logging request never mentioned. Anchor: `auth/login.py:5-7`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\b(lock\w*|failed.attempts|brute\w*)/i` AND `/\b(remov\w*|no longer|dropp\w*|delet\w*|without|never|bypass\w*)/i`. Requested region: `auth/login.py:12-12`, where a claim must be labelled requested.
- **24-subtle-dropped-await**: The audit write is no longer awaited, so a failed audit no longer stops the deletion. Anchor: `accounts/delete.ts:2-2`; target checks: behaviour-change, silent-decision, failure-path. Required concept groups: `/\baudit\w*/i` AND `/\b(await\w*|fire.and.forget|not wait\w*|without wait\w*|no longer wait\w*)/i`.
- **25-subtle-falsy-fallback**: An explicit limit of zero now becomes 50, because || falls back on any falsy value. Anchor: `src/paging.js:2-3`; target checks: behaviour-change, silent-decision. Required concept groups: `/\b(zero|0|falsy)/i` AND `/\b(50|default|fallback|fall|replac\w*|instead|treat\w*)/i`.
- **26-clean-extract-helper**: Clean refactor; every check must return zero claims.
- **27-clean-test-added**: Clean refactor; every check must return zero claims.
- **28-clean-rename-param**: Clean refactor; every check must return zero claims.
- **17-clean-docs**: Docs-only; must bypass all model checks.

## Method and reproduction

- `pnpm evals` stays offline: the original six pipeline smoke cases assert deterministic mock behaviour; this matrix also runs with MockProvider, whose scores are NOT model-quality evidence. Mock matrix scores do not gate CI.
- Run `pnpm evals:live --report docs/EVALS.md` to explicitly use Gemini; `--split tune|holdout` limits the cases and `--pace-ms` sets the gap between calls (default 5000, excluded from latency). Text above the generated marker is kept. Loads root .env (existing environment wins); skips successfully without GEMINI_API_KEY. GEMINI_MODEL defaults to gemini-3.5-flash-lite. No fallback model is used, keeping attribution unambiguous.
- Each cell calls production runChecks with exactly one unchanged check markdown prompt and the production zod schema/untrusted wrappers. Checks and cases are sequential, so the reported total is not review latency; the mean slowest cell approximates the parallel check stage. The first 429 stops the entire run, without retrying the 429 or falling back. Deterministic prechecks and injection scan run first; docs bypass is excluded from model clean-case metrics.
- Fixtures are hand-written before/after files committed to temporary Git repositories; production loadChange generates the diff. Repositories are removed afterwards. No code from fixtures is installed or executed.
- The hand-authored expected claim/rubric is never sent to the model. One claim must overlap the fixed file/line anchor and match ALL concept regexes in its summary/evidence; silent-decision must also label it silent. No model grades another model.
- This lexical score is reproducible but can reject correct paraphrases and accept sufficiently similar incorrect prose. It measures seeded claim detection, not exam-question usefulness, correctness of all extra claims, or end-to-end planning/risk thresholds. One small, single-run corpus is not a general accuracy estimate.
- Only score/count/timing metadata and hashes are retained. No raw model output, repository diffs, transcripts, API error bodies, or secrets are logged or stored in this report.

## Provenance (SHA-256)

Check prompt hashes:

- behaviour-change: 1756f405df4f7df052338a3845b8bacb385d8a9dc1ae65b70058cb0f69c297a3
- failure-path: e43992bcbc6ac3389c0287cfe356ab1b95d7ed56d9b23a329daf200de2282bea
- silent-decision: bcbc3d506a7b41ff323af94c8f3ecb2fedb66daaa71fd727e9ce2fbf6146272b

| Case | Fixture + rubric hash | Per-check output hashes (matrix order; — means no parsed output) |
| --- | --- | --- |
| 01-page-boundary | b5f8b20f49bae8164f3abcf1260a8682ec6d0dd55171ab04a0244fe1cabbe62f | 50bf432584439c99146a601bd1311312ce62607937808836e547c97e79258dfb / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / e3963259eea0c50cb2fb40084a817bc368e247eaafdaf219f461fb7e5f6f1da6 |
| 02-flipped-access | 8c41c178185b25c3ceff0a2222964435da7de2568e54a782496cfc10fc8b92e7 | 35553d445b82209b17800a0c1ab42f4aeb33bf9511c799803822db02d007d7c2 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 2ecee12ce4182dc1ed84512341529e5308c0d2ad728af96eaef7ab49c446dd02 |
| 03-null-customer | 69224cecc7e9b77b8130c3593b6748e8866e1988fb0ca4b94e81f5c1b57d12cb | 59097c115755e45c5a20c34ef4be0ccb4ab3cf391a99c4a434de66785b7d9d43 / 3b02bdae4f42d7c6644ed7ca94b7645d86a2aa531fe84ff0134519f88cd21059 / 1e9ab41cacadbf7c9e6f50ac8af9aa94c6b31893c6c24fc9337eddb4a60c8920 |
| 04-side-effect-order | 61272019eaa1151c5f12ad2b76288d1c0a8971561e170b7a6be4c2452885e438 | 31e30ca7898ab91dc7a0ad4f184fb3d8b6c28649b04903f27206a04113d326ca / 8bd09481eb2b093cfc99bc2be4a08a6850f665508810de094b6c0919c8cad0d7 / 5990f9965bec447890f183a06da6e50a94a01411171e7fe0c121a979a5f0440b |
| 05-changed-default | f7b999426c3e6d2dccb80dea4848416872b3fc46b3f08315e385050b3bfd963c | 388c5e337f5b5efb7ba0c82e64c548825f511bc502085f12047d11af10b9abe8 / d366b1b0499dbdc2659b6609dc759689d2fdeb7f4867e5de62173a99fcef8aa1 / b15e44d40cb9d38fd90cfd7f5f6671c0aea4b58b6ad265a3c1bcd1b2f718ea6c |
| 06-removed-validation | 5c06a6343f53b28d8ce28ca62d99b1b52b416a9dc68ad8d7cdf9af3566951ce3 | 76d429141686b872c9c7d8390f4b05ed35968a5c61c3b6c38bd8447a2ea93b96 / 597413ac5fc349749c41877fbc14142c49adc612d615c06e40b2bc8299974c6c / 33055ede4e52e37d770afc42ef5d4e63fac4934fb2f295c556174c365cdd3c95 |
| 07-swallowed-error | 511a60fbf307af793622e40df626591f37c6306ddb1ccf27b57f3fb61fe76508 | 177a5af68c15ee070f11358436a0b9d13c36c85bb434fafbd8961e455136324d / 9af2b6a25ced6966985cf0db435c9366ad9552d9987ae683703ea4d588ddc016 / e0237216e00055601f10f9636c2e731695136467557482ecae4ccb63f2f50a43 |
| 08-timeout-unit | ba42e348f6abb762f7e0289f609d32f2252e87e54500e88334c817dcf73d9c53 | ba016bd8c4cb5861f25b3c92218338e27633d29437ebe5ad1b9857aac3feeb51 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / e538383463b35a44576514de7c261eab012578ba8412daf97019b0125f0288e1 |
| 09-retry-attempts | 71a7766b081dd6cd235d116b9a6dc945d97584905d3a9d97f802d07e3a63cd7b | d335e2c00bddac511cb7b709c9139f8e9cdab08ba26f2bbf1d0e3b1b7647dea4 / 4569ae4e5b4cd46f1e25eeb1ee8fe4cc312008a9765df8e07c8b0eca4b92bf6c / c9468d800a5e2b986e736e4e509c6ab91e01083c97af4238705a790780328060 |
| 10-silent-dependency | 652b4cff8878e3ae35eff804e48d6181f79373362b5c725d95998606a0c66e62 | 008c83ecdd754cab62408538290f4fce541332fc5b0741af0e6a64db3879efca / 1bd35ae9a9bce8617d0cddc5e572b1dfa4dc009cd32d44d165eb83bf2b01e28b / 49b1c970eb3fe80d971d2b4798a293eb0995b0886deef4001c5c3dc464b86205 |
| 11-buried-invoice | 83ed3458113158be26b192bc424aee064c29ceefb66d146e71afe15328c0882f | 55f79c30cef8bc1801e65f72d86085e0b7b7103ff24eedcfd4fb1cfdbf9706a5 / 224a93e8d4754c6fae06bda3a2b76e82299a7a118d7c07d21a39b903ef928693 / 0454260303db265f9029ae6ef5a2266170822fdb2367debdca1cb7a4657bf855 |
| 12-buried-tenant-scope | 3d779005643f12fc33185f016f40cb0f317ef4a654eefb761431b04ffe0f13f0 | 41db9b6e9e94b6a2d5fad38b55c7826c9d29d9c5180e7af0157d1a3c38e191b9 / d89a2505d7712906accc26e7df3d4e9bb04b8f0e71fcfd6e84bcbe3cd1235ff7 / fd65e762098d06ce940a98bbd4fb51a26c459533cc01fb53f45d9dc33e52173a |
| 13-clean-guard | ad4fd960e4b031add17e5690ac87efa739ca4460a95d6c1a3db22e14596a7630 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 14-clean-retry-rename | 8a101abfc8f0d5a6b2a75b9227ef6c045c94f8bae426f5d4cc90b575129973ec | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 15-clean-default-extract | 955530881aa8047a172c1bbc03c6d3891e16c98f322c52bae3679f3f5176bab6 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 16-clean-sql-layout | 81fa2e82b5d5ef48d335c38d9673b25499d74b4b4dbc9233798ac92951b43ed7 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 18-requested-default | efa5da7c857e067c33dbda82af55205146024dc72a6993699be9bd517d1691b6 | c52d1b5623389f0e7e43e76b7e5a4d3f277267b8940f68d2d0a20979f6f6a89a / 9eb5d1673a9b63ebd8516d2ecd8b4ef9c215b5012761607fe6b8751329819ee9 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 19-requested-retry | bed5e97e4bcffd0f9cad00427c99ec95b19bb07da38344cfd9c63fba036ef7b9 | 3ed59196b851d0248fb77772b5b49a5ea3a548dbdf253b9dafb28dcc8d3bbd88 / 8fd210db1582c81b5c04fae7cd9932272fbb8eb0ae8f793920449dcd6b09bbde / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 20-requested-timeout | b2cd30b31c72d0aa82d02658f4b201bc05ceefaabe53f56d68b95f976eb33e07 | c0e376bcd9c4e75854d5ad132efdd4270ec42db2f98f8470dbb78748db246771 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 21-requested-status | ed4036a30e5588b61d99a9cb7e9c0361422bee4e8322041f91b050bbea2cbb54 | 9ca9b3fc598eb9b71675e5820ffe041544f6a72d1f45a73fae8fc2a441127ee5 / 85c72f256115f7f6fdd2c82a71cf0e08be55ef20ad6296ba12e893b83d5e5394 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 22-mixed-upload-limit | 5451199f1e5224692c0d91272a98d1adf38ac9eefbb7aaec1cd867f3f166c4ee | 57ec8bafcd511fd151dc48975e896803c98ff3da70192964006bd8956660aead / 7788c46be2f0726467773e81071c0aef9ea0701d6f07e2ec1eae5597ed48f6c4 / dcfa4493d463e34b2c0b219d3214d7c81ac034b4157b11f6e1695dabaae69fea |
| 23-mixed-login-lockout | 4ab1cbf952c681797f0aac97f61cea7d7713a8a6a8fa84a42ae3f121a3de5e77 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 739496b5ad6d3383e238d0ecce8e663821881d6c344100bd78e783b8289b0520 |
| 24-subtle-dropped-await | c798a3c5ce94a794e9413a391203610d3567cb844fa5f6ef58e85dd89e32cb13 | 941bc5535c46ee876961896506b9fb5782a49e1f2953ef492d2ea01badafba84 / 5a5234709e5798b9ca4a691993e07746422ee8b896854aea8f58d33dfdeac509 / 10fac8d63f5a7a1802174e48c2349217259270f038d22b663520beab0990ad1f |
| 25-subtle-falsy-fallback | a1134f26509474276368c671e974ca6f2322ac00230eb81e255a033f0d0fd562 | b5e17bec54c2e62e98be5510db27e84167db3adb4cd1c34a00c47fe3811f26c1 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / ca27c1ec5b76a78beb3f529ac7f4599bb1ad2a2900239737733c68c31343c363 |
| 26-clean-extract-helper | 4cfa33591bacf6df99dabddec713e389f34e18a048283976994e4f82db8060cd | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 27-clean-test-added | 19ccad614af5cbc622526baa88d0898d98838972f53f97f1804d8e1e7a3d65d0 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 28-clean-rename-param | b7f2f481d9e8143120779679169c3ff84f0d284b4a7753e10612c6e14bb44c39 | 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 / 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945 |
| 17-clean-docs | 03dbe5b39cc4191a2eaa6d630e75f6b9202d427523c103464cbf076696a6250c | — / — / — |
