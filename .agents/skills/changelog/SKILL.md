---
name: changelog
description: Write the CHANGELOG.md entry for the pull request of a Rowbly Story, and keep the changelog of the branch free of merge conflicts with the base branch. Use when a Story is in the Changelog Stage.
---

# Changelog

This skill adds one entry for a Story to the `### Pre Release` section of `CHANGELOG.md` on the
branch of the Story pull request. Do not change other files in this skill.

This is a skill of the Rowbly repository only. It is not a bundled skill in `skills/`.

Run each `rowbly` command as `rowbly -C <root> --json ...`.

- A native factory worker uses the canonical Project root of the Run section of its first message.
- Other agents use the main checkout as `<root>`. It is the first entry of `git worktree list`.

Do not run `rowbly` in a linked worktree without `-C <root>`. The worktree has its own copy of `.rowbly/`.

## Procedure

1. Read the Story: `rowbly -C <root> --json story get <story-id>`. A native factory worker already has it in its first message.
2. Find the pull request and its branch. Use the URL in the `pull_request` field. If the field is empty, run `gh pr list --head story/<story-id> --state open --json url,headRefName,baseRefName`. If there is no open pull request, the result is `blocked`.
3. Get the worktree of the branch:
   - If the `worktree` field has the path of a linked worktree that exists, use it. Run `git -C <worktree> switch <branch>`.
   - Otherwise, run `git worktree add <main checkout>-worktrees/<story-id> <branch>`. If Git says that a different worktree has the branch, use that worktree.
   - Do not do the work in the main checkout.
4. Update the branch:
   1. Run `git -C <worktree> pull --no-rebase origin <branch>`.
   2. Run `git -C <worktree> fetch origin <base>`. `<base>` is the base branch of the pull request, usually `main`.
   3. Run `git -C <worktree> merge --no-edit origin/<base>`.
   4. If the merge has conflicts, do "Merge conflicts".
5. Read the full diff of the pull request: `git -C <worktree> diff origin/<base>...HEAD`. Read the Story and the pull request text. Find the changes that users can see.
6. Write the entry. See "The entry".
7. Do "Check the changelog".
8. Commit and push:
   1. `git -C <worktree> add CHANGELOG.md`
   2. `git -C <worktree> commit -m "docs(changelog): add the entry for <story-id>"`. If Git has nothing to commit and the merge of step 4 made no commit, the entry is already correct. Continue.
   3. `git -C <worktree> push origin <branch>`. If the push fails because the remote branch changed, go to step 4 one more time.

## Merge conflicts

Run `git -C <worktree> diff --name-only --diff-filter=U` to find the files that have conflicts.

- If a file other than `CHANGELOG.md` has a conflict, run `git -C <worktree> merge --abort`. The result is `conflicts`. Give the names of the files.
- If only `CHANGELOG.md` has a conflict, repair it:
  1. Use the text of `origin/<base>` for all of the file: `git -C <worktree> checkout --theirs CHANGELOG.md`.
  2. Then write the entry of this Story again. See "The entry".
  3. Run `git -C <worktree> add CHANGELOG.md` and `git -C <worktree> commit --no-edit`.

Do not keep a conflict marker. Do not remove or change an entry of a different Story.

## The entry

Each Story has one entry. The entry is one line in the `### Pre Release` section:

```markdown
- <Type>: <text> (<story-id>)
```

- `<Type>` is one of `Added`, `Changed`, `Fixed` or `Removed`. Use the type of the most important change.
- `<text>` tells a user what changed. Use the names that a user sees: commands, flags, keys, screens and files. Do not give the names of internal modules or functions.
- Write `<text>` in ASD-STE100 Simplified Technical English. See `docs/contributing/documentation-language.md`. Use one sentence if possible. Do not use more than two.
- If the Story has no change that users can see, for example a refactor, a test or a change to the documentation, write a short entry about the work with the type `Changed`.

Example:

```markdown
- Added: `rowbly story list --stage <key>` shows only the Stories in one Stage. (ROW-42)
```

Put the entry in the file:

1. Remove each line in `CHANGELOG.md` that ends with `(<story-id>)` and that is in `### Pre Release`. An earlier worker wrote it.
2. Add the new entry as the last line of the list in `### Pre Release`. Keep one blank line between the `### Pre Release` heading and the list, and one blank line after the list.
3. If the `### Pre Release` section has no list, add the entry after one blank line below the heading.

Do not change a section of a released version, for example `### 0.17.0`. A Story entry is never in a released section. If an entry of this Story is in a released section, that Story was released before. Keep that entry and add a new one.

## Check the changelog

Run `git -C <worktree> diff origin/<base> -- CHANGELOG.md`. Make sure that all these conditions are true:

- The file has exactly one `### Pre Release` heading, and it is above all the version headings.
- The diff adds only the entry of this Story, and removes only earlier entries of this Story.
- The diff does not change a line below the first version heading.
- The file has no conflict marker (`<<<<<<<`, `=======` or `>>>>>>>`).

If a condition is false, repair the file. Then do this check again.

## Result

- Report `complete` with the entry and the commit that you pushed.
- Report `conflicts` with the names of the files that have conflicts with the base branch.
- A factory worker reports `blocked` only in the conditions of its first message, or if the Story has no open pull request.

Do not move the Story. The Stage prompt sets the next steps.
