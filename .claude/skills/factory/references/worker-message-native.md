Work on Story {{story}} in Stage {{stage}}.
The canonical Project root is `{{root}}`.
Your worktree is `{{worktree}}`. Your model is {{model}}.
Read the repository instructions. Read the work skill at `{{skill}}`.
No person is available. Make a decision from the repository and record each assumption.
The native manager replaces harness thread and model commands. Record each check that cannot run in the result problems.
Preserve existing branch work and dirty files. Do not reset or delete a worktree.
Do not write to the worktree copy of `.rowbly/`. Do not commit canonical `.rowbly/` files.
For each canonical Project change, use this exact command prefix:
`flock -w 60 {{lockQuoted}} {{shimQuoted}} -C {{rootQuoted}} --json`
Use shell quoting for each path. A lock timeout fails the operation. Retry once, then record the problem.
Do not run Rowbly without arguments.

Project instructions:
{{instructions}}

Stage prompt:
{{prompt}}

Complete all steps of the Stage prompt. The Story Stage on disk is the authority.
Call `report_result` with the outcome, summary, blockers and problems. Then stop.
The result tool does not move the Story. If the tool is unavailable, end with `RESULT: <outcome>`.
