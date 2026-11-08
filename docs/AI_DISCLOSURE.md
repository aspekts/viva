# AI disclosure

HackTheBurgh requires us to disclose AI use and explain what it did. Keep this current.

- **Scaffold:** the initial architecture and code were generated with Claude Code, then reviewed by the team.
- **Sessions:** agent sessions are captured with Entire from the first commit.
- **Typed exam flow (#12):** the answer helpers, exam room and mock grading were written with Claude Code, then driven end to end in headless Chrome (empty, load error, 404, blocked and allowed paths).
- **Gate results (#13):** the gate-reason copy table, result screen, skip flow and failed-review fixture were written with Claude Code, then driven in headless Chrome (failed, hard gate, passed).
- **Fog map (#10):** the treemap layout and map view were written with Claude Code, then run and checked in a browser at projector size. A global formatter hook reformatted the whole repo during the session, so those changes were reverted and only the files for this issue are committed.
- **Visual identity (#11):** three directions were drafted with Claude Code and the team chose "An oral exam, marked in red pen". The tokens and styles were then written with Claude Code and checked in headless Chrome.
- **Demo repo (#14):** `demo/setup.ts` and the commit-message intent fallback were written with Claude Code, then pushed against live Gemini to check both the pass and the fail path.
- **Voice exam (#22):** the ElevenLabs agent, signed-session endpoint and `VoiceExam` component were written with Claude Code. The agent was created through the ElevenLabs API with auth required and voice recording off.
- **ACP agent:** `apps/vivad/src/acp.ts` was written with Claude Code from the ACP v1 schema, then driven over stdio against the live daemon.
