# Viva

**You didn't write it. Can you defend it?**

Viva shows which parts of an AI-written codebase no human understands, then questions you on the riskiest parts before you ship them.

Built at HackTheBurgh XIII. See [the design](docs/DESIGN.md), [the architecture](docs/ARCHITECTURE.md) and [the task list](docs/TASKS.md).

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

Commit a change in that repo and `git push`. Risky changes pause the push until the exam is finished at the link it prints.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the daemon and web UI |
| `pnpm test` | Runs unit and integration tests |
| `pnpm evals` | Runs the eval matrix |
| `pnpm check` | Runs typecheck, tests and evals. Run this before opening a PR |

## Who owns what

| Area | Owner | Where |
|---|---|---|
| Backend, engine, Entire | Marcus | `packages/engine`, `apps/vivad` |
| The Fog | Kay | `apps/web/src/fog` |
| Exam room and voice | Sophina | `apps/web/src/exam` |
| Demo, evidence, submission | Pedro | `evals`, `docs` |
| Shared data shapes | Everyone, via PR | `packages/contracts` |
