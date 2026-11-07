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

## Design rules

- **Fail open.** If the daemon is down, the push goes through with a warning. Reliability beats coverage, as in HRT's Blobby talk.
- **Budget per review.** `MeteredProvider` counts tokens and enforces a cap, so a bug can't burn the credits.
- **Separate grader.** The examiner converses, while the grader only sees the transcript and rubric, so accent and fluency can't affect a score.
- **Ledger in git notes.** It needs no server, travels with the repo, and leaves your branch alone. `refs/notes/viva` has to be pushed explicitly to share it.
- **Understanding expires.** Mastery halves every 14 days, and halves again when the code changes.

## Known gaps

- entire-graph is a stub, and blast radius uses `git grep`.
- The Entire session reader only sees checkpoints in local git refs. Commits linked after the fact with `entire session attach`, and checkpoints stored in another repo, return no session. Subagent transcripts are not read.
- A push mixing agent and hand-written commits gets context for the agent commits only, so a hand-written change can look unrequested.
- Session text is fenced with `untrusted()` but the injection scan only covers the diff, so a hostile transcript relies on that fence alone.
- Traces don't exist yet. When they do, they must store stage names and token counts only, as `LlmRequest.user` holds the transcript.
- `pnpm evals` still uses the mock provider, so check quality on real diffs is unmeasured.
- The fog is per file, with blast radius at 0. Symbol-level needs entire-graph.
- Reviews are held in memory, so restarting the daemon loses them.
- Ledger notes aren't pushed automatically yet.
- The pipeline has only run on macOS. CI covers Windows, but nobody has tried the hook on Windows yet.

## Open problems

From G-Research's list, and worth raising with their judges:

- Callers in other repos that nobody declared.
- Asking questions of confidential design docs without leaking them.
- Determining the risk of a repo with this system enabled.
