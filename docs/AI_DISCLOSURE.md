# AI disclosure

HackTheBurgh requires us to disclose AI use and explain what it did. Keep this current.

- **Scaffold:** the initial architecture and code were generated with Claude Code, then reviewed by the team.
- **Sessions:** agent sessions are captured with Entire from the first commit.
- **Typed exam flow (#12):** the answer helpers, exam room and mock grading were written with Claude Code, then driven end to end in headless Chrome (empty, load error, 404, blocked and allowed paths).
- **Gate results (#13):** the gate-reason copy table, result screen, skip flow and failed-review fixture were written with Claude Code, then driven in headless Chrome (failed, hard gate, passed).
- **Fog map (#10):** the treemap layout and map view were written with Claude Code, then run and checked in a browser at projector size. A global formatter hook reformatted the whole repo during the session, so those changes were reverted and only the files for this issue are committed.
- **Visual identity (#11):** three directions were drafted with Claude Code and the team chose "An oral exam, marked in red pen". The tokens and styles were then written with Claude Code and checked in headless Chrome.
- **Viva buddy:** the pop-up, sprite atlas and styles come from Sophina's AnimePix mockup. Claude Code ported them to TypeScript as `apps/buddy`, wired them to the review API and the pre-push hook, and wrote the tests. It was checked with `vite build` and module loads, not in a browser. The anime character art from the mockup was replaced with Rex, a pixel dino drawn in code, so the repo ships no third-party artwork.
- **Demo repo (#14):** `demo/setup.ts` and the commit-message intent fallback were written with Claude Code, then pushed against live Gemini to check both the pass and the fail path.
- **Voice exam (#22):** the ElevenLabs agent, signed-session endpoint and `VoiceExam` component were written with Claude Code. The agent was created through the ElevenLabs API with auth required and voice recording off.
- **ACP agent:** `apps/vivad/src/acp.ts` was written with Claude Code from the ACP v1 schema, then driven over stdio against the live daemon.

## Multi-agent development in JetBrains Air

Sophina ran the frontend side of Viva as a multi-agent build in JetBrains Air, with Claude
(Opus 5.5) and Codex (GPT-6.1 Sol) working side by side. She kept the product decisions and
reviewed what the agents produced.

- **Parallel workstreams.** Separate agents took the frontend and the buddy, the Git hook and
  review pipeline, and integration testing, so all three moved at once and then came together.
  The shared schemas in `packages/contracts` and the sample data in `fixtures/mock` made that
  possible. The interface agents built against agreed data shapes long before the backend was
  finished.
- **One user journey as the shared target.** Every agent worked towards the same flow: a developer
  runs `git push`, the review finds a risky change, and the buddy opens and asks them to explain
  it. Each agent had a concrete goal, and the interface stayed tied to how the review actually
  behaves.
- **Agents checking each other on what must not break.** Most agents ran at the same time on
  different tasks. For the two behaviours Viva can never get wrong, blocking a risky push and
  letting a push through when the daemon has crashed, more than one agent reviewed the same
  work. We compared their findings to surface edge cases before merging.
- **Steering, not accepting.** Air let her move between UI changes, backend work and debugging
  without rebuilding context each time. The fast loop of changing, running and fixing kept the
  team quick under hackathon pressure. Every change still went through a reviewed pull request.
  Defects that agents shipped and review later caught are now regression cases in our own eval
  suite (`evals/cases/real.ts`, r01 to r06). Viva is measured against the mistakes our own
  agents made.

<!-- Screenshots of the multi-agent workflow in Air go here. -->
