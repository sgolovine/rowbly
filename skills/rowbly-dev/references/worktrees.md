# Linked Worktree Contract

Use this contract whenever a workflow requires an isolated Git worktree. The calling skill supplies the repository, exact start point, local branch name, worktree path, remote push target, and task-specific retention policy.

1. Treat the original checkout as a control checkout only. Inspect its status, branch, remotes, and refs, but do not switch branches, fast-forward it, stash changes, clean it, or alter pre-existing user work.
2. Fetch the refs required by the calling workflow without checking them out. Resolve the chosen start point to a commit SHA before creating the worktree. For an existing PR, require that SHA to match the head OID reported by GitHub before doing repository-backed analysis.
3. Choose a unique local branch and a unique sibling path outside the repository. Never place a linked worktree inside the repository. If the branch or path exists, do not reuse, delete, reset, or force it; choose another unique name or stop for direction.
4. Always create the branch and linked worktree directly with the `git` CLI using `git worktree add --no-track` from the explicit start point. Do not use harness-provided worktree tools, APIs, or helpers. Without `--no-track`, a branch started from a remote-tracking ref such as `origin/main` tracks that ref, so an upstream-style push, pull, or sync would target the parent branch:

   ```bash
   repo="/absolute/path/to/control-checkout"
   start_ref="<verified-ref-or-sha>"
   branch="<unique-local-branch>"
   repo_name="$(basename "$repo")"
   worktree="$(dirname "$repo")/${repo_name}-worktrees/<unique-task-name>"

   mkdir -p "$(dirname "$worktree")"
   git -C "$repo" worktree add --no-track -b "$branch" "$worktree" "$start_ref"
   ```

5. Verify isolation, provenance, and that the new branch has no upstream before continuing:

   ```bash
   test "$(git -C "$worktree" rev-parse HEAD)" = \
     "$(git -C "$repo" rev-parse "${start_ref}^{commit}")"
   test -z "$(git -C "$worktree" status --porcelain)"
   ! git -C "$worktree" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null
   git -C "$worktree" status --short --branch
   ```

6. After setup, run every repository read, search, analysis, edit, build, test, commit, and push from the linked worktree. Keep run logs and generated evidence outside every checkout unless they are intentional project files.
7. Allow only one writer at a time in a worktree. Read-only workers may run concurrently only when their tools will not create caches, lockfiles, generated files, or other writes.
8. For work tied to a mutable remote branch, re-fetch and compare its current OID with the last expected OID before the first edit and before each push. If it moved unexpectedly, stop and reconcile through the calling workflow; never hide divergence with a force push or history rewrite.
9. Push with the explicit remote and destination supplied by the calling workflow. Do not assume the unique local branch has the same name or remote as the branch being updated. The first push sets the upstream to that destination, never to the parent branch; do not run a bare `git push` before it. Then verify the upstream:

   ```bash
   destination="<remote-branch>"   # "$branch" for a new task branch
   git -C "$worktree" push -u origin "HEAD:$destination"
   test "$(git -C "$worktree" rev-parse --abbrev-ref '@{upstream}')" = "origin/$destination"
   ```

   If the upstream names `main`, `master`, `develop`, or another parent branch, stop pushing and correct it with `git branch --set-upstream-to=origin/<destination>` after the destination exists, or `git branch --unset-upstream` before then.
10. Report the control checkout, linked worktree, local branch, start SHA, and final disposition. Leave the worktree in place by default. Remove it only when the calling workflow or user explicitly requires cleanup, and never use forced removal for a dirty worktree.
