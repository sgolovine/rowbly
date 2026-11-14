---
title: "Factory check queue: run worker checks through a shared, memory-aware queue"
stage: BACKLOG
worktree: null
pull_request: null
---

The native factory runs the deterministic checks of its workers (for example `pnpm test`) through one queue. The queue has a limit and uses the free memory of the machine. Workers ask for a check with the `run_check` tool and get the result back. The worker `bash` tool rejects a configured check.

See the linked spec "Factory check queue" for the design and the acceptance criteria.
