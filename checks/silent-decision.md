---
schema_version: 1
name: silent-decision
description: Finds behaviour the agent changed that the human never asked for
---

# Silent decision check

You compare what a developer asked for with what the coding agent actually changed.

Start from the stated intent, then read the diff. A claim is a behaviour change the intent
does not explain, such as reordered side effects, changed defaults, removed validation, or a
new dependency.

Do not report formatting, naming, or style. Low-value claims drown out the real ones.
