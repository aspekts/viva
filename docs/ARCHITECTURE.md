# Architecture

Viva reviews the human, not the code. It deliberately follows the same design as Mabel, the PR engine G-Research described in their workshop, so that it feels familiar to engineers who run this kind of system.

| Mabel | Viva |
|---|---|
| Reviews whether the code is right | Reviews whether a person understands it |
| GitHub PR, Kafka, review service, Kubernetes job, Python harness | `git push`, pre-push hook, local daemon, engine |
| One question per check, in markdown | Same, in `checks/` |
| Verdicts: reject, defer, approve, endorse | Same |
| Aggregate: worst wins | Same, across graded answers |
| Deterministic checks before any LLM call | Same, so many pushes cost no tokens |
| Prompt injection scan defers | Same, and it is a hard gate |
| Some gates can't be disabled by config | `skippable: false` gates |
| Changes to its own config need a human | `.viva/config.json` and `.viva/checks/` are protected |
| Findings stay in the job. Only verdict, counts and status leave | Diffs and transcripts stay in the review. Only scores and hashes reach the ledger |
| Evals: tests for prompts, graded on finding bugs and not flagging clean changes | `evals/`, same grading |

## The review

```
git push
  -> pre-push hook -> vivad
  -> collect the diff and session context
  -> deterministic prechecks       docs only, too large, protected paths
  -> injection scan                match: defer, cannot be skipped
  -> checks, in parallel           one question each, schema-enforced
  -> risk ranking                  plain arithmetic, no model
  -> plan up to 3 questions
  -> exam                          voice or typed
  -> grade                         separate model, transcript and rubric only
  -> aggregate, worst wins
  -> ledger -> verdict -> hook
```

Each step stops the review if it can decide, so the cheapest step wins.

## Push contexts and retries

The CLI uses an Ink typed exam when output is attached to a real terminal and no known agent/CI marker is present. Its input comes from the controlling terminal, not the hook's stdin (which contains Git ref updates). It shows question locations, submits the complete answer set to the existing daemon API, and displays grades. Skip-with-debt requires confirmation and remains unavailable for `skippable: false` gates; the daemon also enforces this.

Without a usable terminal, the hook prints the browser exam link and exits non-zero after review creation, with instructions to finish the exam and retry the push. It does not poll. Browser auto-open is limited to likely local desktop sessions; known agents, CI and SSH sessions only receive the link. Review creation and reads have 15-second timeouts; answers and skips have 120 seconds. A submission deadline blocks this push with retry instructions because grading may still be running; pending exams are reused. Dead-daemon and infrastructure failures retain the fail-open policy.

The daemon deduplicates reviews by a SHA-256 identity of canonical repository path, resolved base/head commits, developer and intent. Pending exams are reused in memory. Completed decisions are written atomically under Git's private `viva-decisions` directory; receipts hold only the identity hash, review ID, gate status and timestamp. Both passes and failures survive daemon restart, so a failed exam cannot turn into a new low-risk approval on retry. No diff, answer, question or model prose is persisted in this cache. Pending exams are regenerated after restart; their old links expire. Exam completion writes the decision receipt before appending attestations, and marks the in-memory review complete before touching the ledger. A failed receipt write leaves the ledger untouched; a ledger failure retains the decision and cannot replay attestations on retry, though mastery for that review may be missing.

`GET /v1/reviews/:id/feedback` exposes missed concepts and question locations from the in-memory review. `viva feedback <id>` formats them as untrusted data for the developer; only an explicit `--agent claude|codex` invokes an agent CLI, passing the feedback on stdin. Detailed feedback expires on daemon restart, with an explicit error; the gate decision remains. A skip leaves fog/mastery unchanged and is retained as `skipped-with-debt` in the local decision receipt.

`GET /v1/reviews/:id/code` shows the UI the lines under discussion. It serves only files in the review's commit range, from the head commit's object store rather than the working tree, and only to loopback hosts. Code stays out of logs, the ledger and decision receipts.

`GET /v1/events` is a server-sent event stream, so the UI needn't poll. Events only say that a review or a repo's fog changed, and the UI refetches. While someone is listening, the daemon checks each reviewed repo's HEAD and `refs/notes/viva` every 2 seconds, as a commit changes the fog without any review. There's no stage-by-stage progress during a review, and events aren't replayed after a reconnect.

`GET /v1/fog` maps the repo of the most recent push, unless `?repo` names one. The daemon only holds that in memory, so after a restart it returns an empty map with `repoPath: null` until the next push.

`GET /v1/reviews` lists reviews newest first, and a repeat push of a decided change moves it to the front. The UI opens the first one when the URL has no review ID.

## Decision memory

After a passed exam the developer can choose to save their answers as project memory, with `m` in the terminal exam, `pnpm viva remember <reviewId>`, or `POST /v1/reviews/:id/memory` from the UI. It is never automatic. The daemon holds a passed exam's answers in memory only until then, so a restart forgets them (410). Only passed answers about files the push changed are kept.

Memory is plain markdown, committed with the code: `.viva/memory/<path>.md` for the source file `<path>`, holding one section per decision with the claim, the question and the developer's explanation, plus a machine-readable comment with the location, person, date and commit. We chose this over a second notes ref because:

- Agents read files. An agent changing `src/pay.ts` finds `.viva/memory/src/pay.ts.md` by path or by grep, with no Viva tooling. `pnpm viva memory <file>` prints it as untrusted data.
- It travels with the repo in normal pushes, unlike notes refs, which must be pushed explicitly. It also goes through code review like any change, and Entire captures it with the commit.
- The developer sees what's stored: the save prints it, `git diff` shows it, and nothing leaves the machine until they commit.

It is separate from the ledger, which still holds only scores and hashes. `.viva/memory/` is not a protected path, so saving memory doesn't trip `viva-config-changed`, and a push that also touches `.viva/config.json` or `.viva/checks/` is still a hard gate. Missing or damaged memory reads as empty, and a failed save never changes a verdict.

## Design rules

- **Fail open.** If the daemon is down, the push goes through with a warning. Reliability beats coverage, as in HRT's Blobby talk.
- **Budget per review.** `MeteredProvider` counts tokens and enforces a cap, so a bug can't burn the credits.
- **Separate grader.** The examiner converses, while the grader only sees the transcript and rubric, so accent and fluency can't affect a score.
- **Ledger in git notes.** It needs no server, travels with the repo, and leaves your branch alone. Reviews and Fog loads start a background fetch, at most once a minute per repo (and never overlapping a refresh), of `refs/notes/viva` from `origin` into a separate tracking ref and merge with `cat_sort_uniq`. Local notes are never overwritten. Exam attestations trigger background publication; `viva ledger sync` explicitly retries fetch, merge and publication. Pushes use `--no-verify` to avoid hook recursion and retry once after fetching and merging a competing update. Fetch and push share a 20-second network budget with an outer deadline for inherited helper pipes; local merges have no timeout. Requests read the available local ledger immediately and pick up fresh notes on the next read. Transport disables Git credential prompts and supplies noninteractive SSH only when neither SSH environment variable nor `core.sshCommand` is set. It fails open without logging Git output. Notes writes and merges are serialized within the daemon, including linked worktrees; network sync queues separately and never holds the local-write lock. Malformed lines are ignored when reading union notes. Failed publication leaves local entries available for a later explicit sync. Nothing beyond the existing attestations is added to notes.
- **Understanding expires.** Mastery halves every 14 days, and halves again when the code changes.

## Known gaps

- Anyone who can push to origin can add attestations under any name, which can earn `earned-trust` approvals. Attestations are published to origin automatically, so they are public on a public repo.
- A network timeout on Windows can leave an SSH or remote-helper process alive even though the caller returns. Fetch uses a separate tracking ref, and local notes merges are never killed by the deadline, so it does not interrupt a writer holding `refs/notes/viva.lock`. After an external crash, Git may still leave a lock: Viva fails open and retains local notes. Do not automatically delete locks; only remove a confirmed stale lock after verifying no Git writer is active, then retry `viva ledger sync`.

- entire-graph is a stub, and blast radius uses `git grep`.
- The Entire session reader only sees checkpoints in local git refs. Commits linked after the fact with `entire session attach`, and checkpoints stored in another repo, return no session. Subagent transcripts are not read.
- A push mixing agent and hand-written commits gets context for the agent commits only, so a hand-written change can look unrequested.
- Session text is fenced with `untrusted()` but the injection scan only covers the diff, so a hostile transcript relies on that fence alone.
- Traces don't exist yet. When they do, they must store stage names and token counts only, as `LlmRequest.user` holds the transcript.
- `pnpm evals` is offline; `pnpm evals:live` measures Gemini claims. The corpus is small and hand-written, and Flash-Lite versus Flash is still unmeasured; see [EVALS.md](EVALS.md).
- The fog is per file, with blast radius at 0. Symbol-level needs entire-graph.
- Full reviews and feedback are held in memory. Only completed retry decisions survive daemon restart.
- The pipeline and terminal hook have been exercised on macOS (including a PTY with piped hook stdin). CI covers Windows, but Windows controlling-console behaviour is not yet verified; console failure falls back to the browser.

## Open problems

From G-Research's list, and worth raising with their judges:

- Callers in other repos that nobody declared.
- Asking questions of confidential design docs without leaking them.
- Determining the risk of a repo with this system enabled.
