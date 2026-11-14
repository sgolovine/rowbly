/**
 * The first message that a native worker gets. The caller reads every value and passes it in.
 * This file does no I/O, so the text below is the complete prompt.
 */
export interface WorkerPromptInput {
  /** The Story ID, for example `WEB-42`. */
  readonly story: string;
  /** The Stage key of the Story, for example `IN_DEVELOPMENT`. */
  readonly stage: string;
  /** The absolute path of the canonical Project root. */
  readonly root: string;
  /** The absolute path of the worktree of the worker. */
  readonly worktree: string;
  /** The model of the session, as `<provider>/<modelId>`. */
  readonly model: string;
  /** The path of the `SKILL.md` of the Stage, or an instruction to use the Stage prompt. */
  readonly skill: string;
  /** The text of `.rowbly/ROWBLY.md`, or an empty string. */
  readonly projectInstructions: string;
  /** The prompt of the Stage, from the Project config. */
  readonly stagePrompt: string;
  /** The absolute path of the Rowbly CLI shim of the daemon. */
  readonly shim: string;
  /** The absolute path of the Project write lock. */
  readonly lock: string;
}

/** Quotes a value for a POSIX shell. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function workerPrompt(input: WorkerPromptInput): string {
  const { story, stage, root, worktree, model, skill, projectInstructions, stagePrompt, shim, lock } = input;

  return `
Work on Story ${story} in Stage ${stage}.
The canonical Project root is \`${root}\`.
Your worktree is \`${worktree}\`. Your model is ${model}.
Read the repository instructions. Read the work skill at \`${skill}\`.
No person is available. Make a decision from the repository and record each assumption.
The native manager replaces harness thread and model commands. Record each check that cannot run in the result problems.
Preserve existing branch work and dirty files. Do not reset or delete a worktree.
Do not write to the worktree copy of \`.rowbly/\`. Do not commit canonical \`.rowbly/\` files.
For each canonical Project change, use this exact command prefix:
\`flock -w 60 ${shellQuote(lock)} ${shellQuote(shim)} -C ${shellQuote(root)} --json\`
Use shell quoting for each path. A lock timeout fails the operation. Retry once, then record the problem.
Do not run Rowbly without arguments.

Project instructions:
${projectInstructions}

Stage prompt:
${stagePrompt}

Complete all steps of the Stage prompt. The Story Stage on disk is the authority.
Call \`report_result\` with the outcome, summary, blockers and problems. Then stop.
The result tool does not move the Story. If the tool is unavailable, end with \`RESULT: <outcome>\`.
`.trim();
}
