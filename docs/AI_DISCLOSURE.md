# AI disclosure

HackTheBurgh requires us to disclose AI use and explain what it did. Keep this current.

- **Scaffold:** the initial architecture and code were generated with Claude Code, then reviewed by the team.
- **Sessions:** agent sessions are captured with Entire from the first commit.
- **Typed exam flow (#12):** the answer helpers, exam room and mock grading were written with Claude Code, then driven end to end in headless Chrome (empty, load error, 404, blocked and allowed paths).
- **Fog map (#10):** the treemap layout and map view were written with Claude Code, then run and checked in a browser at projector size. A global formatter hook reformatted the whole repo during the session, so those changes were reverted and only the files for this issue are committed.
