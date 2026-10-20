# ADR-0025: Tests guard only what review cannot check

**Status:** Accepted. Built.

The suite had grown to 1,134 tests in 121 files. A pull request waited about 90 s of wall time and 500 s of CPU for them, and one test failed intermittently on `main`. Most tests repeated each other: a behavior was tested in its service, again through the CLI, again through the TUI, and again for every input. Most covered what a reviewer checks by reading the diff or running the change once: help text, layout, validation messages, key hints.

**§1 By default, a change adds no test.** It is verified by running it, and the pull request says how.

**§2 A test is required only for these:** how Rowbly writes, locks or recovers a Data Root (ADR-0019); the contracts that scripts, agents and git rely on (exit codes, the JSON error shape, the key order written to disk); the Plugin pipeline and loading rules (ADR-0010, ADR-0011, ADR-0012); a rule that a doc or ADR says a test enforces; a failure mode that an agent skill rates HIGH or CRITICAL; a core command workflow, as one step of the end-to-end scenario; and a fix for data loss, corruption or a race. `AGENTS.md` (Tests) lists each with the file it belongs in.

**§3 The suite has a budget.** About 70 tests remain. A change that would take it past 100 removes a weaker test or asks the user. A test that spawns the built CLI needs a reason, since it is slower than an in-process one.

**§4 What was removed** is in git history, in the change that added this ADR. A removed test needs no replacement unless §2 requires one.

We rejected keeping the suite and running it in more CI jobs: review would still wait for the slowest job, and the tests would still have to be updated with every change. We rejected a percentage coverage target: it rewards tests of what is easy to reach, not what is costly to get wrong.
