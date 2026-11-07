# Tasks

Ordered by priority. Pick one, branch, and open a PR. Each should stay small enough to review.

## Backend (Marcus)

- [ ] **Real model:** run `GeminiProvider` on real diffs and fix it. Then run `pnpm evals` with it.
- [x] **Entire session source:** read the `Entire-Checkpoint` trailer and load the prompts and transcript.
- [ ] **Silent decisions:** tune `checks/silent-decision.md` until it separates requested from unrequested changes on real sessions. Question quality decides whether this project works.
- [ ] **entire-graph:** use it for blast radius, and measure tokens with and without it.
- [ ] **Brain:** save spoken reasoning as project memory.
- [ ] **Streaming:** push review events to the UI over SSE.
- [ ] **Persistence:** keep reviews across restarts.
- [ ] **Ledger sync:** push and fetch `refs/notes/viva`.
- [ ] **Skip with debt:** expose it in the CLI and record it in the ledger.

## The Fog (Kay)

- [ ] Replace the placeholder with the real map and fog visual.
- [ ] Animate fog rolling in and clearing.
- [ ] Add teammate colours and the bus-factor view.
- [ ] Set the visual identity.

## Exam room (Sophina)

- [ ] Add the ElevenLabs agent. Feed it the plan and capture the transcript.
- [ ] Add `highlight_code` and show the code being discussed.
- [ ] Add the live transcript, typed fallback and verdict screen.
- [ ] Add skip with debt.

## Demo and evidence (Pedro)

- [ ] Confirm the JetBrains criteria and how Air must be used.
- [ ] Build the demo repo with one seeded silent bug.
- [ ] Add 10-15 real agent diffs to `evals/cases`, including clean refactors.
- [ ] Run the comprehension study with hackers on Sunday morning.
- [ ] Write the pitch, opening on the problem and closing with "pick any file and quiz any of us".
- [ ] Finish the Devpost submission and `docs/AI_DISCLOSURE.md`.

## Stretch

- [ ] Memory layer for "is this the right direction?" questions, suggested in the team doc for G-Research.
- [ ] JetBrains tool window showing the map.
- [ ] Trail comment with the verdict.
- [ ] Tiger Data debt-over-time chart.
