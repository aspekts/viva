# Demo

The demo repo is a small shop whose payment webhook an agent "adds retries" to. The agent also quietly moves the duplicate check after the charge, so an event delivered twice charges the card twice. The tests still pass.

## Run it

```sh
pnpm demo        # builds ../viva-demo-shop with one unpushed commit; run again to reset
pnpm dev         # daemon, web app and buddy site; leave running
# In another terminal:
cd ../viva-demo-shop && git push
```

The push is blocked and the buddy site opens in your browser. Answer there, then retry `git push`. To answer in the terminal instead, run `pnpm viva exam <reviewId>` from the Viva checkout, using the ID printed by the hook.

`pnpm demo` deletes and rebuilds the demo repo and its local remote each time. It does not push to GitHub. With `VIVA_LLM=mock` in `.env`, no API key is needed: the mock flags risky keywords and accepts answers containing `behaviour`, such as "The behaviour changes because a duplicate event can charge the card again." This tests the hook and UI wiring. Use `VIVA_LLM=gemini` and your own `GEMINI_API_KEY` for real model reviews; the examples below describe that flow.

- **Pass:** "It gets charged again. The retry change moved the `hasProcessed` check after `chargeCard`, so a duplicate charges first and only then returns duplicate." Endorsed, and the push goes through.
- **Fail:** "It retries the charge a few times so the payment is more reliable." Rejected, with the missed point shown.

## What happens

- The commit message ("Add retries to the payment webhook") is the stated intent when there's no Entire session. So the retry helper counts as requested, and the reordered check counts as silent.
- Measured on live Gemini Flash-Lite (Sun 09:10): the review took about 5.5 seconds, using 4 model calls and about 4,500 tokens.
- The demo repo pushes to a local bare remote (`../viva-demo-shop-origin.git`), so it needs no network apart from Gemini.
