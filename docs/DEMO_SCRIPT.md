# Demo script

About 4 minutes, plus questions. One laptop drives (Marcus's Mac, which has the Gemini and ElevenLabs keys). Pedro speaks, Marcus drives. Rehearsed against live Gemini at 11:40 on Sunday: push blocked in about 6 seconds, answer graded in about 1 second, and the Fog cleared live.

## 10 minutes before

Run these in the `viva` folder:

```bash
git pull
pnpm dev                 # leave running in its own terminal
pnpm demo                # in a second terminal: resets the shop with one unpushed agent commit
```

Check:

- [ ] http://127.0.0.1:4317/v1/health says `"llm":"gemini"`
- [ ] Laptop on the charger, notifications off (Focus mode), screen mirroring on, browser zoom up to about 125%
- [ ] Mic works: on http://localhost:5173, the voice button asks for the microphone, and you allow it
- [ ] Tabs open in this order:
  1. The Fog for the demo repo: `http://localhost:5173/?repo=<full path to viva-demo-shop>` (Fog tab)
  2. A terminal in `viva-demo-shop`, font size up
  3. WebStorm with `viva-demo-shop` open and **Viva** selected in AI Chat (JetBrains track only)
- [ ] The backup recording is on the desktop

Do **not** switch git branches in the `viva` folder while `pnpm dev` is running. It breaks the buddy site's link to the daemon.

## The script

### 1. The problem (30s): Pedro, on the Fog tab

> "AI agents now write a big share of the code we ship. But nobody is checking whether a human understands it. Here's a small shop's codebase. Every grey tile is code that no human has shown they understand. That's comprehension debt, and today it's 3,000 points and growing with every agent commit."

### 2. The agent's change (30s): Marcus, in the terminal

> "We asked an agent to add retries to the payment webhook. The tests pass. Let's push it."

```bash
git push
```

Rex pops up in the browser.

### 3. Rex catches it (45s): Pedro, on Rex

> "Viva read the change before it left the laptop. Two decisions. The retries were asked for. But the agent also quietly moved the duplicate check after the card charge. Nobody asked for that. If the payment provider sends the event twice, the customer pays twice. Risk 91. Viva won't let it through until someone can defend it."

Click **Defend it**, then **Open in the full exam room**.

### 4. The viva (60s): Marcus, by voice

Click **Answer by voice**. The examiner asks something like "what happens when an event arrives twice?" Answer:

> "It gets charged again. The retry change moved the duplicate check after the charge, so a repeat event charges the card first and only then returns duplicate. The check has to run before the charge."

The words appear in the answer box as you speak. Click **Submit**.

> Pedro: "One question, not a quiz on every line. Viva only asks where the risk is: unrequested, wide blast radius, untested, and nobody on the team has shown they understand it."

### 5. The fog clears (30s): Pedro, back on the Fog tab

`webhook.js` clears and shows Marcus's name. Back in the terminal, run `git push` again, and it goes through.

> "Now someone on the team understands that file, and Viva knows who. That's the ledger: it's stored in git notes, with no transcripts and no code ever leaving your machine. Understanding fades: it halves every two weeks and drops when the code changes, so the fog rolls back in."

### 6. In your editor (30s, JetBrains track): Marcus, in WebStorm

Type `/review` in AI Chat. The same exam appears in the agent chat, with a checklist and the diff. After a wrong answer, `/guide` gets Rex to walk you through it step by step.

> "It's not only a git hook. Viva is an ACP agent, so it runs in JetBrains, Zed and any editor that speaks the Agent Client Protocol."

### 7. Close (20s): Pedro

> "You didn't write it. Can you defend it? Viva makes sure someone can, before it ships."

## If something goes wrong

| Problem | Do this |
|---|---|
| The question is odd, or a correct answer fails | Say "Viva's examiner is a model, so let's take a fresh one", run `pnpm demo`, then `git push` again. That takes about 10 seconds |
| Voice doesn't start or mishears | Type the answer in the same box. Typing is always allowed |
| Rex shows "Oops, I couldn't reach Viva" | Check `pnpm dev` is still running. Restart it, run `pnpm demo`, and push again |
| Gemini errors or 429 | Switch to the backup recording. Don't debug on stage |
| The push goes straight through | The hook is missing: run `pnpm demo` again, which reinstalls it |

## Questions to expect

- **"Isn't this just code review?"** Review checks the code. Viva checks the person: can the developer explain what the agent did? It asks one or two targeted questions, not a review of every line.
- **"How accurate is it?"** Be honest. On our seeded cases it found 15 of 16 bugs. On real agent changes from our own repo history it found 1 of 6 and flagged 3 of 4 clean changes. That gap is what we'd work on next. The eval harness is in the repo (`pnpm evals:live`).
- **"Can't people just skip it?"** Yes, deliberately, by pushing with debt. The code stays under fog and the team can see it. Hard gates can't be skipped: changes to Viva's own config, and suspected prompt injection.
- **"What about privacy?"** Only scores and code hashes go into the ledger. ElevenLabs is set not to record audio, and grading only sees the transcript, never tone or pace.
- **"What if the daemon is down?"** The push goes through with a warning. Viva never blocks you because it broke.

## Sponsor tracks, one line each

- **ElevenLabs:** the voice viva, with a signed-session examiner agent that never sees the rubric.
- **Gemini:** every check, question and grade runs on Gemini Flash-Lite, with an eval harness to measure it.
- **Entire:** Viva reads Entire checkpoints to learn what the developer asked the agent for, which is how it tells "requested" from "silent".
- **JetBrains:** the ACP agent in WebStorm and AI Chat.
- **G-Research:** deterministic prechecks before any model call, worst-verdict-wins aggregation, and hard gates.
