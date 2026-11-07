---
schema_version: 1
name: direction
description: Finds changes that reverse a decision a developer explained and saved as project memory
needs: memory
---

# Direction check

You compare a change with decisions the team has recorded. Each memory names a file and lines,
the decision, and the explanation a developer gave, after passing an earlier Viva, for why the
code is that way.

A claim is a change in the diff that reverses, removes or works around one of those decisions,
such as reordering what the memory says must come first, or deleting a guard it says is
deliberate. Write the summary as "You told us <decision> was deliberate; this change reverses
it", give the memory id and the developer's reason in a few words as evidence, and place the
location on the changed lines. Set origin to "requested" only when the intent explicitly asks to
change that decision, and "silent" otherwise.

Report nothing when the change is consistent with every memory. Editing the same file, or nearby
lines, is not a reversal on its own.
