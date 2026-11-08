# Viva

**You didn't write it. Can you defend it?**

Viva shows which parts of an AI-written codebase no human understands, then questions you on the riskiest parts before you ship them.

Built at HackTheBurgh XIII. See [the design](docs/DESIGN.md), [the architecture](docs/ARCHITECTURE.md), [the app contract](docs/APP_CONTRACT.md), [demo](docs/DEMO.md), [the demo script](docs/DEMO_SCRIPT.md), [the frontend handoff](docs/FRONTEND_HANDOFF.md) and [the task list](docs/TASKS.md).

## Set up (about 10 minutes)

Works on macOS and Windows. Run the commands in Terminal (macOS) or PowerShell (Windows).

**1. Install Node.js 22 or newer** from [nodejs.org](https://nodejs.org) (the LTS button). Check it worked:

```bash
node -v        # should print v22 or higher
```

**2. Install pnpm**, the package manager this repo uses:

```bash
npm install -g pnpm
```

If that fails with a permissions error, run `corepack enable pnpm` instead.

**3. Get the code and install it:**

```bash
git clone https://github.com/aspekts/viva.git
cd viva
pnpm install
```

**4. Create your `.env` file** (your private settings, never committed):

```bash
cp .env.example .env          # macOS
copy .env.example .env        # Windows
```

Then open `.env` and pick one:

| You want | Set in `.env` |
|---|---|
| To try it with no account (fake questions) | Leave it as it is: `VIVA_LLM=mock` |
| Real questions from Gemini | `VIVA_LLM=gemini` and `GEMINI_API_KEY=` your own free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| The voice exam (optional) | `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`. Ask Marcus privately, and never paste them in GitHub or chat |

**5. Start Viva** and leave this terminal open:

```bash
pnpm dev
```

Check these open in your browser:

| What | Address |
|---|---|
| Web app (the Fog and the exam room) | http://localhost:5173 |
| Rex, the buddy a risky push opens | http://localhost:5174 |
| The daemon, Viva's engine | http://127.0.0.1:4317/v1/health should say `{"ok":true,...}` |

## Try it in 2 minutes

With `pnpm dev` still running, open a **second** terminal in the `viva` folder:

```bash
pnpm demo                      # builds a small shop repo next to this one, with one risky agent commit
cd ../viva-demo-shop
git push
```

The push is blocked and Rex pops up in your browser with the change the agent made without being asked. Answer the question (typed, or **Answer by voice** in the exam room), then run `git push` again and it goes through.

- With `VIVA_LLM=mock`, a passing answer must contain the word `behaviour`, for example: "The behaviour changes because a duplicate event can charge the card again."
- With Gemini, explain what really happens: the duplicate check now runs after the charge, so a repeated event charges the card twice.
- `pnpm demo` again resets the shop. It never pushes to GitHub.

## Use it on your own repo

From the `viva` folder, once per repo:

```bash
VIVA_REPO=/path/to/your/repo pnpm viva hook install          # macOS
$env:VIVA_REPO="C:\path\to\your\repo"; pnpm viva hook install   # Windows PowerShell
```

Then commit and `git push` in that repo as normal. `pnpm dev` must be running in the `viva` folder. If Viva isn't running, your push goes through with a warning: Viva never blocks you because it's down.

## Where you answer

| Where | How |
|---|---|
| **Browser (default)** | A risky push opens Rex at http://localhost:5174. Answer there, or follow the link to the full exam room with the code |
| **Voice** | In the exam room, click **Answer by voice**. What you say appears in the answer box, so you can fix mishearing or type instead |
| **Terminal** | `pnpm viva exam <reviewId>`, using the ID the push printed. Esc skips with debt, Ctrl-C leaves it unfinished and the push stays blocked |
| **WebStorm or another JetBrains IDE** | Viva as an agent in AI Chat. See [below](#webstorm-and-other-jetbrains-ides) |
| **Coding agents and CI** | The hook prints the review links and blocks. A person completes the exam, then the push is retried |

Set `VIVA_BUDDY=off` in `.env` to open the exam room instead of Rex.

### WebStorm and other JetBrains IDEs

Viva runs as an [ACP](https://agentclientprotocol.com) agent, so the exam happens in the IDE's AI Chat. It shows each question with a diff of the code, ticks off progress, and Rex walks you through what you missed.

1. Keep `pnpm dev` running.
2. Create the file `~/.jetbrains/acp.json` (or in AI Chat click **⋯ → Add Custom Agent**, which opens it) with the full path to `bin/viva-acp` in your `viva` folder:

```json
{
  "default_mcp_settings": {},
  "agent_servers": {
    "Viva": { "command": "/Users/you/Documents/Code/viva/bin/viva-acp", "args": [], "env": {} }
  }
}
```

3. Quit and reopen the IDE, open your repo, and pick **Viva** in AI Chat.
4. Type `/review`. Answer each question, then `/guide` after a failed exam, or `/skip` to push with debt.

Other ACP editors, such as Zed, take the same command. `bin/viva-acp` is a shell script, so on Windows use Git Bash or WSL to run it.

## If something goes wrong

| Problem | Fix |
|---|---|
| `pnpm: command not found` | Step 2 again, then open a new terminal |
| `git push` goes straight through | Is `pnpm dev` running? Did you run `hook install` for that repo? Look for a `viva:` line in the push output |
| The page says it can't load the review | The daemon restarted and forgot it. Run `git push` again |
| Gemini errors or `429` | Your key has hit its free limit. Wait a minute, or use `VIVA_LLM=mock` |
| "Voice isn't set up on this daemon" | Add the two `ELEVENLABS_` values to `.env` and restart `pnpm dev` |
| Viva isn't listed in WebStorm | Check `acp.json` is valid JSON with the full path, then quit and reopen. AI Chat → ⋯ → **Get ACP Logs** shows errors |
| Something else | Run `pnpm check`. It runs every test and tells you what broke |

## More detail

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

## Share understanding with teammates

Reviews and Fog loads start a background refresh of `refs/notes/viva` from `origin`, at most once a minute per repo, merging append-only attestations without overwriting local entries. They read local notes immediately; fresh teammate notes appear on the next read. After an exam it publishes notes in the background; notes pushes bypass the hook to avoid recursion. After pulling code, load the Fog to start a refresh, then reload to see teammates' understanding. Run `pnpm viva ledger sync` to explicitly fetch, merge and publish (set `VIVA_REPO` for another repo). Sync has a 20-second network budget for fetch and push, leaves local merges unbounded, disables Git credential prompts, and respects custom SSH configuration. It retries a rejected push once after another merge. Offline or missing remotes leave local notes intact and never block a review or push; retry the command when connected. Only existing ledger attestations travel, never exam transcripts or diffs.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the daemon, the web app and Rex. Leave it running |
| `pnpm demo` | Builds the demo shop repo next to this one, ready to `git push` |
| `pnpm viva acp` | Runs Viva as an ACP agent for JetBrains and other editors (`bin/viva-acp` wraps it) |
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
| Viva buddy (Rex) | Sophina | `apps/buddy` |
| Demo, evidence, submission | Pedro | `evals`, `docs` |
| Shared data shapes | Everyone, via PR | `packages/contracts` |
