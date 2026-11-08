# App contract

The agreement between the frontend (`apps/web`) and the daemon (`apps/vivad`). If this doc and `packages/contracts/src/index.ts` disagree, the code wins, so please fix the doc.

**Status key:** ✅ on `main` · 🔜 in an open PR · 📝 proposed, not built

## Rules

1. **Build against the contract, not the backend.** Everything here works with mock data, so you never need to wait for Marcus.
2. **Import types from `@viva/contracts`.** Don't redefine them in `apps/web`.
3. **Parse every response** with its zod schema, as `apps/web/src/api/client.ts` does. A mismatch should fail loudly.
4. **All API calls go through `client.ts`,** so mock mode keeps working.
5. **Changing a shape:** update `packages/contracts`, `fixtures/mock` and this doc in the same PR, and tag the other side.
6. **Need something from the backend?** Add it to [the overnight queue](OVERNIGHT.md), so agents can pick it up while you carry on against mock data.

## Running it

| You want | Command | URL |
|---|---|---|
| Frontend only, with sample data | `pnpm dev:web` | http://localhost:5173/?mock |
| Everything | `pnpm dev` | http://localhost:5173 |

The Vite dev server proxies `/v1` to the daemon on `127.0.0.1:4317`, so always call relative paths such as `/v1/fog`.

## Screens and URLs

| URL | Screen | Owner |
|---|---|---|
| `/` | The Fog | Kay |
| `/?review=<id>` | Exam room for that review | Sophina |
| `/` then the Exam room tab | The newest review, or an empty state when there are none (PR #38) | Sophina |
| Add `mock` to either | Same screen with sample data, for example `/?review=x&mock` | |

`git push` prints `/?review=<id>` when a viva is needed, so that link must always open the exam directly.

**AnimePix buddy (`apps/buddy`, http://localhost:5174):** a separate site the hook opens instead of the exam room for a push that needs a viva, or one that is blocked, when there's no terminal. It takes the same `/?review=<id>` (and `?mock`, `&failed`, `&hard`), uses the same endpoints and gate copy, and links back to the exam room for the code. `VIVA_BUDDY=off` turns it off.

## Review lifecycle

```
POST /v1/reviews
   ├─ decided early ──────────────> stage: done, gate set
   └─ needs a viva ───> stage: awaiting-exam, plan set
                           ├─ POST answers ──> stage: done, gate set
                           └─ POST skip ─────> stage: done, gate: skipped-with-debt
```

**What the UI can rely on:** only `awaiting-exam` and `done` are observable. The other stages exist in the schema, but the request only returns once the review reaches one of those two, so there is no live progress yet. Use a generic loading state.

### Which screen to show

| Review | Show |
|---|---|
| `stage: awaiting-exam` | The exam, using `plan.questions` |
| `stage: done` and `gate` allows the push | Pass screen |
| `stage: done` and `gate` blocks the push | Blocked screen, with skip if `gate.skippable` |

A push is allowed only when `gate.verdict` is `approve` or `endorse`. Reuse that rule rather than inventing another.

### Gate reasons

Suggested wording only. Sophina owns the final copy.

| `gate.reason` | Verdict | Push | Skippable | Meaning |
|---|---|---|---|---|
| `exam-passed` | approve or endorse | Yes | n/a | Answers met the rubric |
| `exam-failed` | reject or defer | No | Yes | At least one answer fell short. Worst verdict wins |
| `skipped-with-debt` | approve | Yes | n/a | Pushed anyway. The fog stays |
| `low-risk` | approve | Yes | n/a | Nothing risky enough to ask about |
| `earned-trust` | approve | Yes | n/a | You've already proven this code |
| `docs-only` | endorse | Yes | n/a | Docs or lockfiles only |
| `too-large` | defer | No | Yes | Change is over the size limit |
| `injection-suspected` | defer | No | **No** | Text in the diff tried to instruct Viva. Needs a person |
| `viva-config-changed` | defer | No | **No** | Viva's own config changed. Needs a person |
| `pipeline-error` | n/a | n/a | n/a | In the schema, but nothing sets it yet |

**Never show a skip button when `gate.skippable` is false.**

## Endpoints

All bodies are JSON. Errors are `{ "error": string }`.

| Method and path | Body | Returns | Status |
|---|---|---|---|
| `GET /v1/health` | | `{ ok: true, llm: string }` | ✅ |
| `POST /v1/reviews` | `ReviewRequest` | `Review` | ✅ Used by the CLI, not the UI |
| `GET /v1/reviews` | | `Review[]`, newest first | ✅ With PR #38, a repeat push moves a review to the front. Use `getLatestReview()` |
| `GET /v1/reviews/:id` | | `Review` | ✅ |
| `POST /v1/reviews/:id/answers` | `Answer[]` | `Review` | ✅ |
| `POST /v1/reviews/:id/skip` | | `Review` | ✅ `skipReview(id)` in `client.ts` with PR #39 |
| `GET /v1/fog?repo=<path>` | | `FogMap` | ✅ `?repo` optional with PR #37 |
| `GET /v1/reviews/:id/feedback` | | `ReviewFeedback` | 🔜 PR #5 |
| `GET /v1/reviews/:id/code?file=&start=&end=` | | `ReviewCode` | 🔜 PR #8 |
| `GET /v1/events` | | Server-sent events, each `data:` is a `VivaEvent` | 🔜 PR #35 |

Notes:

- **Unanswered questions fail.** Send every question in `plan.questions`. A missing or blank answer scores zero, and no retry is offered in the same review.
- **Which repo the Fog maps:** on `main`, `?repo` is effectively required, as without it the daemon maps its own working directory. With PR #37, it maps the most recently pushed repo and `getFog()` needs no `?repo`. Before any push, or after a daemon restart, you get `repoPath: null` and no nodes, so show an empty state.
- **Reviews live in memory.** Restarting the daemon gives a 404 for old IDs, so show a clear "run `git push` again" message.

### Errors

| Status | Meaning | On `main` | With PR #5 |
|---|---|---|---|
| 404 | Unknown review | ✅ | ✅ With a clearer message |
| 409 | Not awaiting an exam, or the gate can't be skipped. With PR #39, also skipping a push that's already allowed | Returns 500 | ✅ |
| 410 | Feedback expired after a restart | n/a | ✅ |
| 500 | Anything else | ✅ Includes the raw message | ✅ Generic message only |

Don't depend on the error text. Handle the status code: with PR #39, `client.ts` throws an `ApiError` with a `status`. Answering or skipping can take a few seconds, as grading calls a model, so disable the button while a request is in flight.

## Data shapes

The schemas in `packages/contracts/src/index.ts` are the source of truth. Working examples are in `fixtures/mock/review.json` and `fixtures/mock/fog.json`.

### Exam room (Sophina)

```ts
Review.plan.questions[]: {
  id: string;
  claimId: string;
  ask: string;              // read this aloud, or show it
  followUpIfVague: string;  // for the voice examiner
  mustMention: string[];    // grading rubric. Never show it before answering
  location: { file: string; lines: [number, number] };  // highlight this
}

Answer: { questionId: string; transcript: string; mode: "voice" | "typed" }

Review.grades[]: {
  questionId: string;
  verdict: "reject" | "defer" | "approve" | "endorse";
  score: number;      // 0 to 1
  missing: string[];  // rubric points the answer missed. Show after the exam
}
```

There are at most 3 questions. Claims live in `Review.claims`: match on `question.claimId` to show `summary` and `evidence`. `origin: "silent"` is the headline, as it's something the agent did without being asked.

**Showing the code** 🔜 PR #8: call `getReviewCode(review.id, question.location)`.

```ts
ReviewCode: {
  reviewId: string;
  file: string;
  commit: string;       // the review's head commit
  totalLines: number;   // in the whole file
  lines: { number: number; text: string; focus: boolean }[];  // focus: the lines asked about
  truncated: boolean;   // true if a very long location was cut off
}
```

You get the asked-for lines plus up to 3 lines of context either side, and at most 200 lines. Render `text` as plain text, as it's untrusted repository content.

Only files in the review's diff are served, from its head commit. **Any error means showing the path and line numbers instead**, which can happen on a normal review:

| Status | Meaning |
|---|---|
| 400 | Missing or invalid `file`, `start` or `end` |
| 403 | The request's `Host` isn't loopback |
| 404 | Unknown review, or the file isn't in the review at its head commit |
| 410 | The repo or commits are gone |
| 422 | Binary, over 1 MiB, or the lines are past the end of the file |

Line numbers come from the model, and the daemon can't tell if they point at the wrong lines. In mock mode, `getReviewCode()` returns `fixtures/mock/code.json` for any location.

### The Fog (Kay)

```ts
FogMap: {
  repoPath: string | null; // PR #37. Null means no push seen yet: show an empty state
  generatedAt: string;
  debt: number;       // total comprehension debt. No fixed unit, so show trends
  nodes: FogNode[];
}

FogNode: {
  id: string;
  file: string;
  symbol: string | null;  // always null for now
  size: number;           // bytes
  blastRadius: number;    // always 0 on live data for now
  fog: number;            // 0 understood, 1 understood by nobody
  knownBy: { person: string; mastery: number }[];
}
```

- `fog = 1 - the best mastery anyone on the team holds`, so one person understanding a file clears most of it.
- Mastery fades with time and halves when the code changes, so fog returns on its own.
- `person` is the Git `user.name`, not a GitHub login. Map colours from that string, and allow for unknown names.
- Node sizes vary hugely, so use a scale such as `sqrt(size)`.
- To show fog rolling in, refetch `/v1/fog` and animate the difference between responses. With PR #35, `watch("fog", reload)` tells you when to refetch. Until it lands, poll every couple of seconds.

### Voice exam ✅

The browser talks to ElevenLabs directly, and audio never passes through the daemon.

1. `getVoiceSession()` calls `GET /v1/voice/session`, which returns `{ signedUrl }`, a one-off ElevenLabs URL. It's a 503 when `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` aren't set on the daemon. The agent requires signed URLs, so its ID alone can't spend credits.
2. `VoiceExam` starts the session with the questions as dynamic variables (`person`, `question_count`, `questions`). The rubric (`mustMention`) is never sent.
3. The agent calls two browser tools:
   - `ask_question({ question_id })` moves to that question, scrolls to its code and marks it as current
   - `end_exam()` finishes the session
4. What the person says streams into the current question's answer box. Answers with speech in them are sent with `mode: "voice"`.

**Fairness rules that aren't optional:**

- Typing always works, including partway through the exam.
- Grading only sees the transcript. ElevenLabs is set not to record audio.
- The transcript appears live in the answer boxes, so people can fix mishearing before submitting.

Never put the ElevenLabs API key in `apps/web`.

### Live events 🔜 PR #35

```ts
VivaEvent =
  | { type: "review"; reviewId: string; stage: ReviewStage; gate: Gate | null }  // created, answered or skipped
  | { type: "fog"; repoPath: string }  // refetch the fog
```

- Use `watch("fog" | "review", refresh)` from `client.ts` rather than `EventSource` directly. It returns a stop function, so return that from `useEffect`.
- `watch` polls every 2 seconds until the stream connects, and whenever it drops. It refetches once on every connect, because missed events aren't replayed. In `?mock` it does nothing.
- Events only say what changed, so always refetch. They never carry code, questions or answers.
- `fog` also fires when someone commits to a reviewed repo with no push, checked every 2 seconds while anyone listens.
- There's still no progress while a review runs.

## Mock mode

Adding `?mock` loads `fixtures/mock/fog.json`, `fixtures/mock/review.json` and, with PR #8, `fixtures/mock/code.json` through the same schemas as live data.

With no `review` in the URL the exam room opens the newest review, or shows an empty state, and only `?mock` gives sample data. In mock mode, submitting blank answers returns a failed review with the missed rubric points, and answered questions return a pass.

With PR #37, `?mock&empty` loads `fixtures/mock/fog-empty.json` and, with PR #38, an empty Exam room. With PR #39, `?mock&hard` loads `fixtures/mock/review-hard-gate.json`, a review blocked by a hard gate, where skip is refused. `?mock&failed` loads `fixtures/mock/review-failed.json`, a failed exam where skip is allowed. To test another state, add a fixture and keep it valid against the schema.

## Gaps to agree

Marcus to confirm. Until these land, build the UI against the proposed shape behind mock data. Add anything new to [the overnight queue](OVERNIGHT.md).

| Gap | Blocks | Proposal |
|---|---|---|
| **Code for the exam:** no way to fetch the lines under discussion | Code highlighting | 🔜 PR #8 |
| **Live progress:** no updates during a review or while fog changes | Fog rolling in live, loading screens | 🔜 PR #35 for fog and review changes. Progress during a review is still open |
| **Latest review:** the Exam room tab has no ID without the URL | Opening the tab directly | 🔜 PR #38: `getLatestReview()`, the first item from `GET /v1/reviews` |
| **Which repo:** the UI doesn't know the repo for the Fog | Live Fog | 🔜 PR #37: the daemon remembers the last pushed repo, in memory |
| **Skip:** not in `client.ts`, and the reason isn't recorded in the ledger | Skip button | ✅ `skipReview(id)` is in `client.ts` and the button shows for a skippable gate. The ledger still doesn't record skips, by design, as the fog stays |
| **Debt over time:** only the current total exists | A trend chart | 📝 Stretch, with Tiger Data |
