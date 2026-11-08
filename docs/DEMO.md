# Demo

The demo repo is a small shop whose payment webhook an agent "adds retries" to. The agent also quietly moves the duplicate check after the charge, so an event delivered twice charges the card twice. The tests still pass.

## Run it

```sh
pnpm demo        # builds ../viva-demo-shop with one unpushed commit; run again to reset
pnpm dev         # daemon and web app
cd ../viva-demo-shop && git push
```

The push is blocked and Viva asks what happens when a duplicate event arrives. Answer in the terminal, or open the link in the web app.

- **Pass:** "It gets charged again. The retry change moved the `hasProcessed` check after `chargeCard`, so a duplicate charges first and only then returns duplicate." Endorsed, and the push goes through.
- **Fail:** "It retries the charge a few times so the payment is more reliable." Rejected, with the missed point shown.

## What happens

- The commit message ("Add retries to the payment webhook") is the stated intent when there's no Entire session. So the retry helper counts as requested, and the reordered check counts as silent.
- Measured on live Gemini Flash-Lite (Sun 09:10): the review took about 5.5 seconds, using 4 model calls and about 4,500 tokens.
- The demo repo pushes to a local bare remote (`../viva-demo-shop-origin.git`), so it needs no network apart from Gemini.
