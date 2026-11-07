# Viva: design doc

**You didn't write it. Can you defend it?**

Viva shows which parts of an AI-written codebase no human understands, then questions you out loud on the riskiest parts before you ship them.

## 1. The problem

AI writes code faster than people can absorb it. The gap is known as comprehension debt, a term [credited to Addy Osmani](https://www.agentpatterns.ai/anti-patterns/comprehension-debt/), and it doesn't show up in tests, linters or diffs.

There is research behind this too. A [randomised study](https://export.arxiv.org/abs/2601.20245) found that AI use impaired conceptual understanding, code reading and debugging, with no significant average speed gain. It also found that some ways of working with AI preserved learning, so the goal is engagement rather than avoiding AI.

## 2. What makes it original

**A merge quiz alone isn't new.** [Commit Comprehension Gate](https://dev.to/islandbytes/i-built-a-merge-gate-that-quizzes-developers-on-their-own-code-changes-heres-why-and-how-5460) already generates multiple-choice questions from a PR diff, and a [quiz-gate plugin](https://claudepluginhub.com/skills/nbbaier-skills/quiz-gate) does something similar. If a judge asks, say so first. Viva differs in four ways:

| | Existing quiz gates | Viva |
|---|---|---|
| **Source of questions** | The diff | The gap between what you asked for and what the agent actually did |
| **Format** | Multiple choice, easy to paste into another AI | Spoken, open-ended, with follow-ups |
| **Memory** | Stateless, per PR | A ledger of who understands what, which decays as code changes |
| **Output** | Pass or fail | A team-wide map, plus your explanation saved as project memory |

The most important row is the first. With Entire's transcripts, Viva can tell apart what you requested from what the agent decided on its own. Those silent decisions are the best questions, and a diff-only tool can't see them.

## 3. The product

### Three pieces

**The Fog (the map).** The repo is drawn as a map under fog of war. Code nobody has demonstrated they understand is covered in fog, and each teammate's understanding clears it in their colour. While an agent writes code, fog rolls in live. This is the G-Research story and the first screen people see.

**The Viva (the exam).** On `git push`, Viva scores the change. If the risk is low, it passes silently. If it's high, the browser opens and a voice examiner asks up to three questions in about 90 seconds, highlighting the code as it talks.

**The Ledger (the memory).** Results are saved per person and per symbol. Mastery fades over time and resets when the code changes. Your spoken reasoning is recorded in entire-brain, so a future agent can find out why the code is the way it is.

### Example exam

> *You asked: "add retries to the payment webhook." The agent also moved the idempotency check to after the charge, and you never mentioned that.*
>
> **Viva:** Say the first attempt charges the card, then times out. What happens on the retry?
>
> **You:** It'd just try again... and the check would catch it?
>
> **Viva:** The check now runs after the charge. Look at line 41. Walk me through the order.
>
> **You:** Oh. It charges twice.
>
> **Viva:** Right. Blocking this push. Your reasoning is saved, and you can send it back to the agent.

The human finds a real bug because they were made to think, which is a far better outcome than a quiz score.

### Keeping it tolerable

A gate people hate gets uninstalled, so these are core features:

- **Most pushes pass silently.** Only risky changes trigger an exam.
- **Earned trust.** Prove you understand an area and Viva stops asking about it. An engineer in their own code rarely hears from it.
- **Skip with debt.** You can always skip, which ships the code but keeps the fog and logs the skip. It's a nudge, not a lock.
- **Typing always works.** This covers noisy rooms, accessibility and people who prefer not to speak.
- **Grade the meaning.** Accent, fluency and hesitation must never affect the score, which is a real fairness risk with a voice exam. Grade the transcript against a rubric.

## 4. Architecture

```
 Agent session ──> Entire (checkpoints, transcript, graph, brain)
                        │
 git push ──> pre-push hook ──> vivad (local service)
                                  │
              ┌───────────────────┼────────────────────┐
         1. Claims           2. Risk scoring       3. Exam plan
         (Gemini)            (deterministic)       (Gemini)
                                  │
                     Browser UI on localhost
                     Fog map + exam room
                     ElevenLabs voice agent
                                  │
                     4. Grader (Gemini, separate)
                                  │
              Ledger ──> verdict to hook ──> push allowed or blocked
                 └──> entire-brain memory, Trail comment (stretch)
```

### Key decisions

- **Local daemon plus a browser UI, not an IDE fork or desktop app.** Microphone access works on `localhost` in a normal browser, so there's no Electron and no native packaging risk. It also works next to any IDE, on Windows and macOS.
- **TypeScript for `vivad`, shared with the frontend.** With one backend developer and 24 hours, one language and shared types matter more than Rust's lower memory use. Move scoring to Rust later only if there's time.
- **The grader is separate from the examiner.** A conversational agent tends to be generous, so a second model scores the finished transcript against a fixed rubric. All LLM calls go through one interface, so we can compare Gemini and Claude on real diffs and switch if one hits a limit.
- **Risk scoring is plain code, not an LLM.** It's fast, cheap, explainable, and lowers token use.
- **The ledger lives in git, using `refs/notes/viva`.** It needs no server, travels with the repo, and sits alongside Entire without touching your branch. Keep a local SQLite cache for speed if needed.

### The pipeline

**1. Claims.** Read the diff and the Entire checkpoint (`entire checkpoint explain <id>`), then extract each decision in the change:

```json
{
  "id": "c3",
  "summary": "Moved idempotency check after the charge call",
  "origin": "silent",
  "symbols": ["handleWebhook", "chargeCard"],
  "location": { "file": "src/webhook.ts", "lines": [38, 44] },
  "evidence": "Not in prompt; agent reasoning at step 7"
}
```

`origin` is `requested`, `inferred` or `silent`.

**2. Risk.** Rank the claims:

```
risk(claim) = blast_radius × origin_weight × untested × (1 − your_mastery)
```

- `blast_radius` comes from entire-graph: how much code depends on these symbols.
- `origin_weight` is highest for `silent`, then `inferred`, then `requested`.
- `untested` is higher if no test covers the change.

If the top risk is under the threshold, the push passes.

**3. Exam plan.** Turn the top three claims into questions, each with a rubric. Prefer "what happens if..." and "why" over recall, since those are harder to fake:

```json
{
  "claim": "c3",
  "ask": "If the first attempt charges then times out, what happens on retry?",
  "must_mention": ["card charged twice", "check runs after charge"],
  "follow_up_if_vague": "Walk me through the order on line 41"
}
```

**4. Exam.** An ElevenLabs agent receives the plan as dynamic variables and calls client tools to drive the UI: `highlight_code(file, lines)` and `end_exam()`. Check the tool API against the [official docs](https://elevenlabs.io/docs/agents-platform/overview) first, as I only confirmed the details from third-party guides.

**5. Grade and record.** Score each claim from the transcript, then write attestations:

```json
{
  "person": "marcus",
  "symbol": "handleWebhook",
  "code_hash": "9f2c...",
  "score": 0.85,
  "at": "2026-11-07T22:14:00Z",
  "quote": "It charges twice because the check runs after..."
}
```

**6. Mastery and fog.**

```
mastery(person, symbol) = score × 0.5^(days / half_life) × code_unchanged
fog(symbol) = 1 − max(mastery across the team)
debt(repo) = Σ fog(symbol) × size(symbol) × blast_radius(symbol)
```

`code_unchanged` is 1 if the code hash matches and falls with churn. The `max` across the team also gives a bus-factor view: code understood by exactly one person can get its own colour.

### Entire integration

The [prize brief](https://hacktheburghxiii.devpost.com/) asks for as many capabilities as possible and for measurable token efficiency. Viva can use all four without forcing it:

| Capability | Use in Viva |
|---|---|
| **Sessions** | Find silent decisions from transcripts |
| **Graph** | Blast radius, and targeted context instead of whole files |
| **Brain** | Store your spoken reasoning as project memory |
| **Trails** (stretch) | Post the verdict with `entire trail comment add` |

Custom Trail review agents need billing set up, so post a comment instead. To show token savings, measure tokens per exam with and without Graph context.

Run `entire enable` on the repo from the first commit. Transcripts get pushed with your code, so keep the repo private during the hack or configure a separate remote, and keep the API keys out of it.

## 5. The demo

**Setup:** a small payment service as a demo repo, with one seeded silent bug. Be open that this part is prepared.

| Time | What happens |
|---|---|
| 0:00 | "The rules say disclose and explain your AI use. Most of the code here was written by AI. Could you explain yours?" |
| 0:20 | Show the map. An agent adds retries and fog rolls in live. |
| 0:50 | Run `git push`. The push pauses and the exam opens. |
| 1:00 | Hand the laptop to a judge. Viva questions them about the silent change. |
| 2:00 | They find the double charge. The push is blocked. |
| 2:20 | Send the reasoning back to the agent, it fixes the bug, and the fog clears. |
| 2:45 | Switch to the map of Viva's own repo, built from this weekend. |
| 3:00 | **Closer:** "Pick any file in this repo and quiz any of us." |

**The closer is the strongest moment.** You dogfood Viva for all 24 hours, so your repo has a real ledger and your AI disclosure comes straight from it. It also means all four of you need to pass vivas on code you didn't personally write, so start doing that early.

Always keep a recorded backup and a typed fallback.

## 6. Tracks

| Track | Fit | The angle |
|---|---|---|
| **MetaView Best Overall** | Strong | A universal problem with a memorable demo |
| **Best Use of Entire** | Strong | Uses all four capabilities in the product, not only the workflow |
| **Best Use of ElevenLabs** | Strong | Voice is the core interaction |
| **JetBrains** | Strong if the rules are met | Built for yourselves, and developed with the Air plugin |
| **G-Research** | Strong | The fog literally makes understanding visible |
| **Best Use of Gemini** | Medium | Claims, planning and grading |
| **Tiger Data** | Stretch | A debt-over-time chart using continuous aggregates |
| **HRT** | Stretch | Only if the mastery model predicts answers and is evaluated |
| **InstaLily** | Skip for now | Needs a fork and their harness; reconsider only if the kit is light |
| **Wordsmith, Lloyds, Viridien** | Skip | No honest fit |

## 7. Evidence

Pedro owns this. Judges will trust numbers more than a claim that it works.

1. **Silent decision detection:** build 10-15 agent diffs with known silent changes, then report precision and recall.
2. **Does passing mean understanding?** Ask 6-10 hackers on Sunday morning to review a diff either by reading it or by doing a viva. Then ask them to predict the output of a new test case. Say clearly that the sample is small.
3. **Token cost:** tokens per exam, with and without Graph.
4. **Dogfood stats:** exams run and bugs or misunderstandings caught on your own repo. Only report what really happened.

## 8. Build plan

Marcus is the only dedicated backend developer, so the plan protects that time. Agree the JSON schemas first and serve mock data, so Kay and Sophina never wait on the backend.

- **Marcus: backend, and fills any gaps.** `vivad`, git hook, Entire integration, claims, risk scoring, grading, ledger.
- **Kay: the Fog.** Map, fog visuals, live updates, overall visual identity.
- **Sophina: the exam room.** ElevenLabs agent in the browser, code highlighting, live transcript, typed fallback, verdict screen.
- **Pedro: PM.** First-hour checks and booth questions, scope and cut decisions, demo repo and seeded bug, evaluation, pitch, Devpost submission, AI disclosure.

Everyone develops with the Air plugin in JetBrains IDEs from the start.

### Checks to do first (under an hour)

Each of these could change the design, so test them first:

1. `entire enable` works on one Windows and one Mac laptop with your chosen coding agent.
2. Find out how to get `entire checkpoint explain` output into a script. I haven't confirmed it has a JSON flag, though `entire search` does.
3. `entire plugin install brain` installs graph and brain, and you can query blast radius from a script.
4. A basic ElevenLabs agent runs in the browser in this room, on this Wi-Fi. Use the MLH ElevenLabs promo code.
5. A `pre-push` hook can pause and wait for a localhost response on Git for Windows.

### Timeline

| When | Goal |
|---|---|
| **By 15:00** | First-hour checks done, schemas and mock data agreed, repo running on both OSes |
| **By 19:00** | **Vertical slice:** a real diff produces a real question, typed in a plain page, and the verdict blocks the push |
| **By 23:00** | Voice exam and ledger working, basic map renders from real data |
| **By 03:00** | Fog visuals, code highlighting, Brain writes, demo repo complete |
| **03:00-08:00** | Sleep in shifts, with vivas on your own code as you go |
| **By 09:30** | **Feature freeze.** Evaluation runs, fixes only |
| **By 11:00** | Rehearse with strangers, record the backup demo |
| **12:00** | Submit, with the AI disclosure. Judging from 12:30, and all four must attend |

For workshops, Pedro should cover JetBrains (16:00) and MLH (18:00), since both affect judging, and G-Research (17:00) if time allows.

### Cut order

If time runs short, cut in this order. The bottom line is the minimum demo.

1. Tiger Data and the debt chart
2. JetBrains tool window showing the map
3. Trails comment
4. Teammate colours and bus-factor view
5. Mastery decay
6. Brain writes (keep if at all possible for the Entire prize)
7. **Never cut:** a real transcript leading to a silent-decision question, a spoken exam, a blocked push, and fog clearing

## 9. YC deals and credits

There are 24 deals on [YC Deals](https://deals.ycombinator.com/deals), and **none is for ElevenLabs**, but MLH provides credits (see below). Get codes and keys from the portal, and keep them out of this doc and the repo.

| Deal | Offer | Plan |
|---|---|---|
| **Anthropic** | $500 in credits, higher rate limits | **Redeem now.** Use for Claude Code while building, and to compare against Gemini |
| **Deepgram** | $15k in credits | **Redeem now.** Backup speech-to-text and live transcript |
| **Vapi** | $100 for applying, about 700-1,000 minutes | **Backup only.** Use if ElevenLabs credits fall through, since it would weaken the ElevenLabs entry |
| **Langfuse** | $100 off a month for 6 months | **Optional.** Tracing helps tune prompts and supports the token-saving numbers |
| **OpenAI** | $1,000 in API credits | **Redeem after the hack.** Takes 3 business days, and JetBrains provides a key |
| **Google** | $2k in cloud credits | **Skip for now.** Needs an application, and AI Studio's free tier covers Gemini |
| **Supabase** | $300 in credits | **Skip.** The ledger lives in git, and Tiger Data is the Postgres prize |

Respan needs a `.edu` email. Greptile, Browser Use, Firecrawl, Blaxel and AWS don't help this project.

### MLH credits

From the [HackTheBurgh prizes page](https://mlh.link/hacktheburgh). Each partner has its own page at `mlh.link/<partner>`.

| Partner | Offer | How to get it | Plan |
|---|---|---|---|
| **ElevenLabs** | Free credits (amount not stated) | Sign in to the prizes page and use **Log In To Claim Code**, or look for the MLH email | **Claim now.** Core to the demo |
| **Entire** | $10 in credits | Sign up at `mlh.link/entire-signup`, then check for the MLH promo email. The MLH Coach can help if it doesn't arrive | **Claim now.** Core to the demo |
| **Gemini** | Free student plan for a year, plus $10 a month in credits usable in AI Studio. $300 for new Google Cloud accounts | Follow `mlh.link/gemini` | **Claim now.** Powers the pipeline |
| **Tiger Data** | $1,000 in credits, valid for 30 days | Sign up at `mlh.link/tigerdata-quickstart` | **Later.** Only if the debt chart makes the cut |
| **Vultr** | $100 in credits | Get a code at `mlh.link/vultr-discover`, then enter it under Billing | **Skip.** Viva runs locally |
| **Solana** | Devnet faucet, no credits listed | `mlh.link/solana` | **Skip** |
| **Auth0** | New prize category; I didn't check for credits | `mlh.link/auth0` | **Skip.** Viva has no login |

## 10. Risks

| Risk | Plan |
|---|---|
| **Noisy room at judging** | Bring a headset with a mic, use push-to-talk if needed, keep typing as the fallback |
| **Speech recognition mangles code terms** | Show the live transcript, and keep questions about behaviour rather than identifiers |
| **Venue Wi-Fi is unstable** | Phone hotspot, plus the recorded backup |
| **Bad or trivial questions** | Most of the quality lies here, so test claims early on real diffs and tune the prompts |
| **Silent-decision detection is unreliable** | Show the source evidence with each question, and fall back to high-blast-radius changes |
| **Marcus becomes a bottleneck** | Build against mock data, and Pedro cuts scope early rather than late |
| **Entire can't be scripted as hoped** | Read `.git/entire-sessions` or the checkpoint refs directly, which may be less stable |
| **Seen as a surveillance tool** | Pitch it as a teammate for the team. Never position it as a manager's scoreboard |
| **"This already exists"** | Raise the existing tools yourselves, then explain section 2 |
| **Prompt injection through code or comments** | Treat diff and transcript content as data in the prompts, and ensure the verdict can only come from the grader |

## 11. Stretch ideas

- **Live intervention:** pause the agent when fog passes a threshold, rather than waiting for the push. This answers the [criticism](https://getmaestro.ai/blog/cognitive-debt-session-problem) that a quiz at the end comes too late.
- **Predict before running:** ask what a test will output, then run it. It's a strong learning pattern and makes for a short, fun exam.
- **Onboarding mode:** a new joiner clears the fog on a repo through guided vivas.
- **Teach mode:** a failed question leads into a short spoken explanation, then a retry.

## 12. Still to confirm

- JetBrains' five judging criteria and exact Air requirement.
- Whether one project can win several prizes.
- Whether the ElevenLabs promo code has arrived, and how many credits it includes.
- Current Gemini model names and rate limits, with the free JetBrains OpenAI key as a backup.
