# Viva

**You didn't write it. Can you defend it?**

Viva shows which parts of an AI-written codebase no human understands, then questions you on the riskiest parts before you ship them.

Built at HackTheBurgh XIII. See [the design](docs/DESIGN.md), [the architecture](docs/ARCHITECTURE.md), [the app contract](docs/APP_CONTRACT.md), [the frontend handoff](docs/FRONTEND_HANDOFF.md) and [the task list](docs/TASKS.md).

## Quick start

You need Node 22+ and pnpm. It works on Windows and macOS.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- **Web UI:** http://localhost:5173
- **Daemon:** http://127.0.0.1:4317/v1/health
- **Frontend only:** run `pnpm dev:web` and open http://localhost:5173/?mock to use sample data with no daemon.

## Try the gate on a repo

With `pnpm dev` running, from this folder:

```bash
VIVA_REPO=/path/to/some/repo pnpm viva hook install
```

Commit a change in that repo and `git push`:

- **Terminal:** risky changes open an Ink exam in place. Type an answer to each question, press Enter to submit, and read the verdict. Esc offers an explicit **skip with debt**; hard gates cannot be skipped. Ctrl-C leaves the exam unfinished and blocks the push.
- **IDE / coding agent / CI:** the hook prints an exam link and exits non-zero immediately after review creation, without polling for a person. On a local desktop it also opens the browser; known agent and CI environments never launch one. Set `VIVA_NONINTERACTIVE=1` for tools without a recognized agent marker. Complete the browser exam or run `pnpm viva exam <reviewId>` in a terminal, then retry `git push`.
- **Retry:** the same repository, commit range and developer reuse the completed decision, including after a daemon restart. A failed exam still blocks. Skipping is an explicit debt decision, not a pass or a mastery attestation.
- **Daemon down / infrastructure crash:** the hook warns and allows the push, as before.

Run the commands below from this Viva checkout. Set `VIVA_REPO` to the target repo when handing feedback to an agent so it runs there.

```bash
pnpm viva exam <reviewId>
pnpm viva feedback <reviewId>
pnpm viva feedback <reviewId> --agent claude
pnpm viva feedback <reviewId> --agent codex
```

Feedback prints the question, code location and missed concepts for pasting into a coding agent. The optional flag explicitly sends it on stdin to `claude -p` or `codex exec -`; an agent is never invoked automatically. Feedback and pending questions are memory-only: after a daemon restart, retry the push to refresh its review. Completed gate decisions survive, but detailed feedback expires.

After a passed exam you can choose to save your explanation as project memory: press `m` in the terminal exam or run `pnpm viva remember <reviewId>`. Viva appends it to `.viva/memory/<file>.md` in your working tree and prints exactly what it wrote. Nothing is shared until you commit that file, and deleting it forgets it. Nothing is saved unless you ask, only passed answers are kept, and the explanation never enters the ledger. Once committed and part of a later push's base, a push that reverses a recorded decision gets a direction question ("You told us X was deliberate; this change reverses it. Is that the right direction?"). Pushes with no memory for their files make no extra model call. Memory is an unsigned claim in the repo, not a verified statement, so a push is only ever judged against memory that was already there before it.

The hook reads answers from the controlling console (`/dev/tty` on macOS/Linux, `CONIN$` on Windows), leaving Git's ref-data stdin untouched. If the console cannot be opened or used in raw mode, it falls back to the browser link. Terminal flow has been exercised through a macOS PTY; Windows console behaviour still needs hands-on verification. For offline development, set `VIVA_LLM=mock` in `.env`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the daemon and web UI |
| `pnpm viva exam <reviewId>` | Opens an existing exam or verdict in the terminal |
| `pnpm viva feedback <reviewId> [--agent claude\|codex]` | Prints missed concepts; optionally hands them to the named agent |
| `pnpm viva remember <reviewId>` | After a pass, saves your answers as project memory in `.viva/memory/` (also `m` in the terminal exam) |
| `pnpm viva memory <file>` | Prints the saved reasoning for a file, for people and agents. Needs no daemon |
| `pnpm test` | Runs unit and integration tests |
| `pnpm evals` | Runs offline mock smoke assertions and the claim matrix |
| `pnpm evals:live` | Opt-in sequential Gemini claim matrix; skips without a key |
| `pnpm check` | Runs typecheck, tests and evals. Run this before opening a PR |

See [the recorded live eval results and grading method](docs/EVALS.md). Use
`pnpm evals:live --report docs/EVALS.md` to write a fresh report, or `--exam` for end-to-end
reviews. Live failures and incomplete runs exit nonzero after reporting, and a 429 exits with
code 75; mock quality scores do not gate CI.

## Demo day

Record the exact demo once while quota is available. Set these variables in the
shell launching the daemon (`export NAME=value` on macOS/Linux;
`$env:NAME = "value"` in Windows PowerShell):

| Variable | Recording | Offline replay |
|---|---|---|
| `VIVA_LLM` | `gemini` | `gemini` |
| `GEMINI_MODEL` | Your live model name | Same model name |
| `GEMINI_API_KEY` | Supply privately | Not needed |
| `GEMINI_FALLBACK_MODEL` | Optional second live model | Not used |
| `VIVA_LLM_RECORD` | `1` | Unset |
| `VIVA_LLM_REPLAY` | Unset | `1` |
| `VIVA_LLM_CACHE_DIR` | Absolute path to this Viva checkout's `.viva/cache` | Same path |

Start `pnpm exec tsx apps/vivad/src/server.ts` and `pnpm dev:web`. Exercise the
chosen commit range and answer every question with the exact stage transcript.
Restart with the offline settings to rehearse with **zero model calls**. Use a
fresh disposable copy of the same commits, without completed decision receipts,
to exercise the exam again; keep the original cache path. **Remove `origin`
(`git remote remove origin`) or point it at a disposable remote in that copy
before rehearsing.** Replayed grades create real attestations, and ledger sync
may publish them. Don't delete real gate decisions. Changed prompts, answers,
schemas or model names miss the cache, so rehearse the whole path, including
grading. Existing exact matches are reused; remove only the disposable cache to
record afresh.

Caching is **opt-in**: only record mode writes; record or replay enables reads.
Otherwise there is no cache I/O. Without an explicit path, `.viva/cache` is
resolved from the daemon module to **this Viva checkout**, regardless of the
directory the daemon was launched from. An explicit `VIVA_LLM_CACHE_DIR` overrides
that location; use only a cache you control.
Keys hash provider, model, request name, prompts and schema. Files contain only
validated results and token counts, and replay revalidates with zod. They can
contain private code and answers: `.viva/cache/` is gitignored; never commit,
log, share or put it in the ledger. Delete it after the demo. Private file
permissions are used where supported.

On a miss, Gemini retains two attempts per model, 800/1600 ms backoff and a
12-second timeout per attempt. Quota/429/RESOURCE_EXHAUSTED, network errors,
timeout or transient server failures try replay again, then
`GEMINI_FALLBACK_MODEL`, then a labelled `model-unavailable` HTTP 503. Fallback output is not cached as primary output.
Replay retains token counts under `MeteredProvider`; failed-call usage is unknown.
Retries can exceed the CLI's 15-second deadline: infrastructure failure warns
and fails open, with no passing exam or mastery credit. Offline replay requires
**word-for-word identical answers**. A cache miss returns HTTP 503, so the hook
warns and the push goes through **unexamined**; it never calls a model.

`/v1/health` reports cumulative use since startup: `gemini+replay`,
`gemini+fallback`, or `gemini+unavailable` (`replay-only` before an offline hit).
There is no automatic mock fallback. For an explicitly simulated demo, use
`VIVA_LLM=mock` (health says `mock`) or open `http://localhost:5173/?mock` for the
existing frontend fixtures. Mock keyword grading is not evidence of understanding.

## Who owns what

| Area | Owner | Where |
|---|---|---|
| Backend, engine, Entire | Marcus | `packages/engine`, `apps/vivad` |
| The Fog | Kay | `apps/web/src/fog` |
| Exam room and voice | Sophina | `apps/web/src/exam` |
| Demo, evidence, submission | Pedro | `evals`, `docs` |
| Shared data shapes | Everyone, via PR | `packages/contracts` |
