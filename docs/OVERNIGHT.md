# Overnight queue

The backend work for agents to pick up while the team is away. If the frontend needs something from the backend, add it here rather than waiting.

## How to add a request

Add a row to **Queue**, and push it to `main` before the next run:

- **Request:** what you need, in one line
- **Why:** the screen or feature it unblocks
- **Done when:** how we'll know it works
- **From:** your name

If it changes an API or data shape, link the relevant part of [the app contract](APP_CONTRACT.md).

## How it runs

Marcus starts each run, as nothing picks this up automatically. Agents work top to bottom, one PR per request, and nothing merges without review. Move finished items to **Done** with the PR link.

## Queue

| Request | Why | Done when | From |
|---|---|---|---|
| Endpoint or question field for the code under discussion | Code highlighting in the exam | The exam can show the lines for each question | Contract gaps |
| Live events for reviews and fog | Fog rolling in live, loading states | The UI updates without polling | Contract gaps |
| Tell the Fog which repo to map | Live Fog shows the wrong folder | Live Fog shows the pushed repo with no `?repo` set by hand | Contract gaps |
| Latest review for the Exam room tab | Opening the tab directly | The tab opens the newest review, or a clear empty state | Contract gaps |
| `skipReview(id)` in `client.ts` | Skip button | Skip works, and is refused on hard gates | Contract gaps |

## Done

| Request | PR |
|---|---|
