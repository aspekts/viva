# Frontend handoff

Your starting point, kept up to date as work lands. For exact API details, see [the app contract](APP_CONTRACT.md).

**Last updated:** Saturday 7 November, 21:37

## Start here

```bash
git pull origin main
pnpm install
pnpm dev:web
```

Open http://localhost:5173/?mock. Everything works on sample data, so you don't need the backend, an API key, or Marcus.

To run the whole thing, copy `.env.example` to `.env` and run `pnpm dev`. That uses a mock model until `VIVA_LLM` is set to `gemini`.

## What we're building

**You didn't write it. Can you defend it?** Viva shows which code no human understands, then questions you on the riskiest parts before you ship.

G-Research said hackathons come down to the demo and presentation, and the UI is the demo. Three moments need to land:

| Moment | What the judges see | Owner |
|---|---|---|
| **Fog rolls in** | An agent writes code, and part of the map disappears under fog | Kay |
| **The viva** | A judge is questioned out loud about a change, while the code highlights | Sophina |
| **Fog clears** | They pass, and the map lifts in the team's colours | Both |

Our closer is "pick any file and quiz any of us", so the Fog has to work on Viva's own repo, not just the demo repo.

## Who owns what

| Person | Area | Files |
|---|---|---|
| **Kay** | The Fog and visual identity | `apps/web/src/fog`, `styles.css` |
| **Sophina** | Exam room and voice | `apps/web/src/exam` |
| **Marcus** | Backend and agents | `apps/vivad`, `packages/engine` |
| **Pedro** | Demo, evidence, submission | `evals`, `docs` |

Both of you touch `apps/web/src/api/client.ts`, so keep changes there small and pull often. The current screens are placeholders, so replace them freely.

## Priorities

**Kay**

1. Build the map from `FogMap`, using `?mock` data.
2. Set the visual identity, as the current styling is deliberately plain.
3. Animate fog changing between two `FogMap` responses.
4. Add teammate colours and show code that only one person understands.

**Sophina**

1. Build the exam flow in typed form: question, answer, submit, verdict.
2. Handle every gate result, including blocked, skippable and non-skippable. The contract has a table.
3. Add the ElevenLabs agent, then the live transcript.
4. Add code highlighting using `getReviewCode()`, once [PR #8](https://github.com/aspekts/viva/pull/8) lands.

Typing has to keep working throughout, as it's our fallback in a noisy room.

## What's happening on the backend

Agents are working on these, and nothing merges without Marcus reviewing it.

| Work | Status | Why you'd care |
|---|---|---|
| Live evals, [PR #3](https://github.com/aspekts/viva/pull/3) | Awaiting review | Tells us how good the questions are |
| Entire session reader, [PR #4](https://github.com/aspekts/viva/pull/4) | Awaiting review | Powers "the agent did this without being asked" |
| Terminal exam and retries, [PR #5](https://github.com/aspekts/viva/pull/5) | Awaiting review | Adds the feedback endpoint, and changes some error codes |
| Check tuning | In progress | Better questions |
| [Overnight queue](OVERNIGHT.md) | In progress | Everything below |

### Coming for you

| Feature | Unblocks | Status |
|---|---|---|
| Code for each question | Code highlighting | [PR #8](https://github.com/aspekts/viva/pull/8), awaiting review. `getReviewCode()` works with `?mock` on that branch |
| Live events | Fog rolling in live | [PR #35](https://github.com/aspekts/viva/pull/35), awaiting review. Use `watch("fog", reload)`, which polls by itself until events connect |
| Fog knows which repo to map | Live Fog | Queued |
| Latest review | Opening the exam tab directly | Queued |
| `skipReview(id)` | Skip button | Queued |

Build these against mock data and the shapes proposed in the contract. If a final shape differs, the change should be small.

## Good to know

- **The exam tab can show fake data.** With no `review` in the URL, it falls back to sample data even when the daemon is running.
- **Only two states are visible:** `awaiting-exam` and `done`. Use a generic loading state, even with live events.
- **Reviews vanish when the daemon restarts.** Show a "run `git push` again" message on a 404.
- **Grading takes a moment,** so disable buttons while a request is in flight.
- **Never show the rubric before an answer.** `mustMention` is in the response, but it gives the answer away.
- **Never put API keys in `apps/web`.** Anything with a `VITE_` prefix reaches the browser.
- **Windows:** use `node:path` and avoid shell-only scripts.

## Need something?

| You need | Do this |
|---|---|
| A backend change | Add a row to [the overnight queue](OVERNIGHT.md) and carry on with mock data |
| A data shape changed | Update `packages/contracts`, `fixtures/mock` and the contract in one PR |
| An API detail | Check [the app contract](APP_CONTRACT.md) |
| Something's broken | Add it to the update log below, and message the team |

## Before you open a PR

- `pnpm check` passes.
- Your screen works with `?mock`.
- Keyboard use and typed answers work.
- Your AI use is noted in `docs/AI_DISCLOSURE.md`, which HackTheBurgh requires.

## Update log

Newest first. Add a line when something changes what the frontend can rely on.

| When | What changed |
|---|---|
| Sat 21:37 | [PR #35](https://github.com/aspekts/viva/pull/35) open, not merged: `watch(topic, refresh)` in `client.ts` calls you back when the fog or a review changes, including when an agent commits. `FogView` and `ExamRoom` already call it. It doesn't show progress while a review runs |
| Sat 21:25 | [PR #8](https://github.com/aspekts/viva/pull/8) open, not merged: `getReviewCode()` and `GET /v1/reviews/:id/code` return the lines for a question. The exam shows them unstyled, in `exam/QuestionCode.tsx`. Sophina, restyle or replace it. Not yet seen in a browser |
| Sat 21:20 | Handoff, contract and overnight queue created |
