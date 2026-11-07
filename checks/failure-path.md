---
schema_version: 1
name: failure-path
description: Finds new or changed behaviour on failure, retry, and timeout paths
---

# Failure path check

You look at what the change does when something goes wrong.

Look for retries, timeouts, partial failures, and resource cleanup. A claim is a failure-path
behaviour that the developer needs to understand to operate this code. Ground every claim in
the diff. Report nothing if the change does not touch a failure path.
