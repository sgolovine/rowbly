import type { StageConfig } from '../../plugin-api';

/** The Stages a software factory Board has between Backlog and Done (ADR-0053 §2). */
export const FACTORY_STAGES: readonly StageConfig[] = Object.freeze([
  { key: 'todo', name: 'TODO' },
  { key: 'in-progress', name: 'In Progress' },
  { key: 'in-review', name: 'In Review' },
]);

/**
 * The default Stage Prompt of each factory Stage, and whether setup turns it on (ADR-0053 §2). They
 * name only published skills, `gh` and `git`: no repository's paths, commands, branches or servers.
 */
export const DEFAULT_PROMPTS: Readonly<Record<string, { enabled: boolean; text: string }>> = Object.freeze({
  todo: {
    enabled: false,
    text: `# TODO

A person planned this Story. Review its readiness and record concrete questions or missing
requirements. This advisory pass never authorizes implementation and keeps the Story in TODO.
A finished Stage Run prevents another automatic pass during this visit. A person can request
another pass after answering with \`rowbly software-factory run clear <KEY>\`; the supervisor never
clears a finished Run to repeat a review. Leaving TODO and returning also starts a new visit.

This pass needs the Comments Plugin, Git, Node 22 or later and the \`rowbly-factory\` skill, whose
\`references/readiness.md\` describes every review input and its fingerprint helper. When one of them
is missing, the review is incomplete: report it as step 6 says.

1. **Read the inputs.** Work in the task worktree you were given, up to date with its base branch
   (merge, never rebase); stop and ask if you cannot. Read the Story, all Comments, Story Specs and
   linked Board Specs, Tasks, Epic (including whether it is closed), Story links and each blocker's
   Stage and Stage Category, Attachments, Assignees, the Board's effective configuration, this
   Stage Prompt and \`ROWBLY.md\`. Check the claims against the repository's code, docs and decision
   records. Do not implement, create branches or PRs, edit tracked files or change the Board.
2. **Collect the fingerprint** from the repository root with the helper in the folder where the
   \`rowbly-factory\` skill is installed:

   \`\`\`text
   node <rowbly-factory skill folder>/scripts/readiness-fingerprint.mjs <KEY> <Data Root> [-- <rowbly command>]
   \`\`\`

   Name the command that runs Rowbly here after \`--\` when \`rowbly\` is not on the path. A result
   that is not complete prints only \`gap=<input>: <reason>\` lines and no \`overall\`. Report every
   gap. Never replace one with empty data, infer that a Plugin is off from a failed read, or hide a
   Plugin to get a complete result: a Plugin whose input the helper does not know is a gap.
3. **Use the comparison.** \`comparison=equal\` is the only reason to skip: add no Comment, report the
   earlier review's date and "no new review input", and finish as step 7 says. \`changed\` needs
   another review that names the changed inputs and which earlier questions are answered, open or
   new. \`unknown\` needs a full review. A gap never counts as equal.
4. **Judge readiness.** Ask only concrete questions: unclear or untestable acceptance criteria,
   scope choices, missing requirements, conflicts with accepted decision records, unresolved
   blockers, dependencies or stack order, documentation and configuration updates, checks and
   screenshots. When every input was read and the requirements are settled, the verdict is "Ready
   for a person to decide"; it never approves implementation. An incomplete review is "Needs
   answers", never Ready. If the Story itself cannot be read, ask with \`FACTORY-QUESTIONS <KEY>\`
   and wait.
5. **Confirm the inputs** by running the helper again after your research. Review anything that
   changed before you report. If either run was incomplete, keep its gaps: the review is incomplete.
6. **Report one Comment** and no other Board change. Its body is one line, in single quotes, without
   an apostrophe inside. Join the helper's lines from \`method=2\` through \`overall\` with spaces; for
   an incomplete review write \`INCOMPLETE; <gaps>\` instead.

   \`\`\`rowbly
   rowbly comments add <KEY> --body 'Readiness review <UTC date>. Verdict: <Needs answers or Ready for a person to decide> | Questions: <concrete questions or none>; Missing: <requirements or evidence>; Changed: <inputs and answered or open questions, or first review> | Reviewed input (method 2): <helper lines, or INCOMPLETE; gaps> | Advisory only; this does not authorize implementation. A person decides when to move the Story.'
   \`\`\`

7. **Stay in TODO.** Report no move or edit, and do not clear a Stage Run, turn on a Stage Prompt or
   start implementation. End with \`FACTORY-DONE <KEY>\`.
`,
  },
  'in-progress': {
    enabled: true,
    text: `# In Progress

A person moves a Story here when it is ready to build. Take it to a draft pull request.

1. Run the \`rowbly-dev\` skill for the Story. Its Story updates (moving the Story, adding Comments)
   become reported \`rowbly\` blocks, as the factory's worker rules say; carry on without waiting.
2. **Returned work.** If the Story's latest Comment starts \`Returned to In Progress:\`, repair that
   work without asking: continue its branch and PR, do not open another. First check that the PR is
   still open and that its branch and head commit are the ones the Comment names; if not, ask, and
   discard nothing. Create your worktree from \`origin/<branch>\` with a new local branch, merge the
   PR's base branch, fix what the Comment lists, run the checks and push with
   \`git push -u origin HEAD:<branch>\`. If a conflict needs another open PR's or stack layer's intent
   to resolve, ask instead of choosing it.
3. **Other earlier work.** Otherwise, if the Story's Comments or \`git branch -r\` show a branch or PR
   for it already, ask whether to continue it or start again before you change anything.
4. **Base.** Start from the repository's default branch on \`origin\`, unless \`ROWBLY.md\` or your
   instructions name another. Before you plan, and again before final validation and the PR, run
   \`git fetch origin\` and merge the base branch into the task branch. Never rebase or force-push.
   The supervisor records Board changes; never commit Data Root changes on the task branch.
5. **Stacks.** If the Story's Comments or your instructions say it is one layer of a stack, base it on
   the branch of the layer below it (merge that branch in, never rebase), open the PR with
   \`--base <branch below>\`, and put a "Stack" section listing every layer at the top of the PR
   description. Never merge PRs yourself.
6. **Numbered records.** If you added a numbered record, such as a decision record, check the base
   branch and the open PR branches for its number before you open the PR; another worker may have
   taken it.
7. **Screenshots.** When the change alters what a person sees and the repository's agent instructions
   or \`ROWBLY.md\` ask for screenshots, add them to the PR as they say, uploaded so they display.
8. **Finish** when the draft PR is open, or the returned PR has your fixes: report a Comment with the
   PR URL, head SHA, validation summary and numbered responses to review findings (for returned work,
   what you fixed). Then report \`rowbly stories move <KEY> in-review\` and end with
   \`FACTORY-DONE <KEY>\`.
`,
  },
  'in-review': {
    enabled: true,
    text: `# In Review

The Story has a draft PR. Review it independently, merge it when it is ready, and finish the Story.

1. **Find the PR** in the Story's Comments, or with \`gh pr list --search <KEY>\`. If there is none, or
   more than one, ask.
2. **Wait for checks without polling.** Do not loop on \`gh pr view\` or \`gh pr checks\`. The supervisor
   owns the wait: finish the work that does not depend on checks (the review in step 3) first. If
   what remains needs them, report the PR URL, the exact head SHA and each pending check's name, end
   your turn and let the supervisor resume you. Do not start a watch, timer or poller. On each
   resume, read once:
   \`gh pr view <n> --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision\`.
   Use every check, not only required ones. If the head changed, discard the old result and process
   the new head.
   - **All passed** needs a nonempty rollup for the current head in which every CheckRun is
     \`COMPLETED\` with conclusion \`SUCCESS\` and every StatusContext is \`SUCCESS\`. No exit code,
     including 0, proves this.
   - **Failed**: a conclusion of \`FAILURE\`, \`TIMED_OUT\` or \`ACTION_REQUIRED\`, or a StatusContext of
     \`FAILURE\` or \`ERROR\`. Return the Story as step 5 says, naming the check and its link.
   - **Waiting**: no checks registered yet, checks still running, or a wait that timed out. Report
     the head SHA and the pending names, or ask; waiting is never a failure.
   - **Undecided**: \`CANCELLED\`, \`SKIPPED\`, \`NEUTRAL\` or any other conclusion does not mean all
     passed. Follow \`ROWBLY.md\` or ask. A PR you cannot read is separate: report the error and ask.
3. **Independent review.** You review this PR; you did not write it. Do it while checks run.
   - Check the Implementation records section after the brief: it must list every verified
     implementing worker and model, and your own verified worker, thread, provider and model. Your
     model must differ from every implementing model (the same provider is allowed; other effort or
     options alone do not count), and you must not be one of their workers. If a record is missing
     or unknown, if that does not hold, or if the branch has commits no record accounts for, ask with
     \`FACTORY-QUESTIONS <KEY>\` and stop. Never push to the branch or edit the PR; you only comment.
   - Note the head SHA (\`gh pr view <n> --json headRefOid\`). A review Comment that already approves
     this SHA, from a model that differs from every record, still holds: say so and go to step 4.
   - Read \`gh pr diff <n>\` and the files it touches. Check the change against the Story's
     description, acceptance criteria, Specs and Tasks, and against the repository's agent
     instructions: unmet criteria, bugs, docs or tests those instructions require, unrelated changes.
     Run a command yourself when reading cannot settle a finding.
   - Post the result as a PR comment (\`gh pr comment <n> --body-file <file>\`) and report the same
     text as a Comment:

     \`\`\`text
     Review of <PR URL> at <head SHA> by <provider instance>/<model>: APPROVED.
     <one paragraph: what you checked>
     \`\`\`

     or \`…: CHANGES REQUESTED.\` followed by numbered findings, each with where (\`file:line\`), what
     is wrong and what would resolve it. List only what must change before the merge; put
     suggestions after them, marked optional.
   - **Changes requested**: return the Story as step 5 says, with the numbered findings.
4. **Merge when approved and ready.** Ready means all of these:
   - a review Comment approves the current head SHA, as step 3 says;
   - the PR is mergeable and \`mergeStateStatus\` is \`CLEAN\`;
   - every check passed;
   - no review requests changes;
   - when the PR changes what a person sees, its screenshots load (each URL returns 200).

   Then read \`headRefOid\` again. If it differs from the approved SHA, the approval no longer holds:
   review the new commits as in step 3. Run \`gh pr ready <n>\`, then
   \`gh pr merge <n> --merge --match-head-commit <approved SHA>\`, with the merge method \`ROWBLY.md\`
   names in place of \`--merge\` when it names one. If GitHub refuses because the head moved, review
   again; never merge without \`--match-head-commit\`. If the PR is the bottom layer of a stack, point
   the next layer at this PR's base afterwards (\`gh pr edit <next layer> --base <base>\`). Report a
   Comment \`Merged <PR URL> at <approved SHA>\` and \`rowbly stories move <KEY> done\`, then end with
   \`FACTORY-DONE <KEY>\`.
5. **Return to In Progress** when the PR targets the repository's default branch and any of these
   holds. Pending checks alone never return the Story.
   - a review requests changes (return at once, without waiting for checks): sum up each finding;
   - a check failed, once every check has finished: name each failing check, link its run, and
     quote the failing step's error (\`gh run view <run id> --log-failed\`);
   - it conflicts with its base: list the conflicting files (\`git fetch origin\`, then
     \`git merge-tree --write-tree --name-only --no-messages origin/<base> origin/<branch>\`).

   Report one Comment that starts \`Returned to In Progress:\` and gives the branch (\`headRefName\`),
   the PR URL, its head commit (\`headRefOid\`) and the failure, then
   \`rowbly stories move <KEY> in-progress\`, then \`FACTORY-DONE <KEY>\`. Do not fix it yourself: an
   In Progress worker continues that branch and PR. If an earlier \`Returned to In Progress:\` Comment
   names the same failure at the same head commit, nothing was fixed: ask instead of returning it
   again.
6. **Ask** with \`FACTORY-QUESTIONS <KEY>\`, instead of returning or merging, when the PR is a stack
   layer whose layer below has not merged, or when a conflict comes from another open PR or stack
   layer, or resolving it means choosing between this Story's intent and another PR's. Name each PR
   and file involved; never pick the other work's intent yourself.
7. End with \`FACTORY-FAILED <KEY> <reason>\` only when you cannot read the PR (for example, \`gh\`
   fails).
`,
  },
});
