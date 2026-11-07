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
| `skipReview(id)` in `client.ts` | Skip button | Skip works, and is refused on hard gates | Contract gaps |

## Done

| Request | PR |
|---|---|
| Endpoint for the code under discussion | [PR #8](https://github.com/aspekts/viva/pull/8), awaiting review, not merged. Stacked on PR #5. No file outside the diff is served, and wrong model line numbers aren't detected |
| Live events for reviews and fog | [PR #35](https://github.com/aspekts/viva/pull/35), awaiting review, not merged. Stacked on PR #8. Shows a review once it's created or decided, but not its progress while it runs. Polling continues as the fallback |
| Tell the Fog which repo to map | [PR #37](https://github.com/aspekts/viva/pull/37), awaiting review, not merged. Stacked on PR #35. Remembered in memory only, so after a daemon restart the map is empty until the next push |
| Latest review for the Exam room tab | [PR #38](https://github.com/aspekts/viva/pull/38), awaiting review, not merged. Stacked on PR #37. Also fixes the exam showing mock data outside `?mock` |
