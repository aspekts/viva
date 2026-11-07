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

Without a usable terminal, the hook prints the browser exam link and exits non-zero after review creation, with instructions to finish the exam and retry the push. It does not poll. Browser auto-open is limited to likely local desktop sessions; known agents, CI and SSH sessions only receive the link. API calls have bounded timeouts. Daemon/infrastructure failures retain the fail-open policy.

The daemon deduplicates reviews by a SHA-256 identity of canonical repository path, resolved base/head commits, developer and intent. Pending exams are reused in memory. Completed decisions are written atomically under Git's private `viva-decisions` directory; receipts hold only the identity hash, review ID, gate status and timestamp. Both passes and failures survive daemon restart, so a failed exam cannot turn into a new low-risk approval on retry. No diff, answer, question or model prose is persisted in this cache. Pending exams are regenerated after restart; their old links expire.

`GET /v1/reviews/:id/feedback` exposes missed concepts and question locations from the in-memory review. `viva feedback <id>` formats them as untrusted data for the developer; only an explicit `--agent claude|codex` invokes an agent CLI, passing the feedback on stdin. Detailed feedback expires on daemon restart, with an explicit error; the gate decision remains. A skip leaves fog/mastery unchanged and is retained as `skipped-with-debt` in the local decision receipt.

## Design rules

- **Fail open.** If the daemon is down, the push goes through with a warning. Reliability beats coverage, as in HRT's Blobby talk.
- **Budget per review.** `MeteredProvider` counts tokens and enforces a cap, so a bug can't burn the credits.
- **Separate grader.** The examiner converses, while the grader only sees the transcript and rubric, so accent and fluency can't affect a score.
- **Ledger in git notes.** It needs no server, travels with the repo, and leaves your branch alone. `refs/notes/viva` has to be pushed explicitly to share it.
- **Understanding expires.** Mastery halves every 14 days, and halves again when the code changes.

## Known gaps

- The Entire adapter and entire-graph are stubs. The session source returns nothing, and blast radius uses `git grep`.
- `pnpm evals` still uses the mock provider, so check quality on real diffs is unmeasured.
- The fog is per file, with blast radius at 0. Symbol-level needs entire-graph.
- Full reviews and feedback are held in memory. Only completed retry decisions survive daemon restart.
- Ledger notes aren't pushed automatically yet.
- The pipeline and terminal hook have been exercised on macOS (including a PTY with piped hook stdin). CI covers Windows, but Windows controlling-console behaviour is not yet verified; console failure falls back to the browser.

## Open problems

From G-Research's list, and worth raising with their judges:

- Callers in other repos that nobody declared.
- Asking questions of confidential design docs without leaking them.
- Determining the risk of a repo with this system enabled.
