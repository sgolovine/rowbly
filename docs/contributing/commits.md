# Commits

Each turn that changes files ends with a commit. The commit uses Conventional Commits and holds only
the changes of that turn. This page gives the full rules.

Read this when you commit a change.

## Rules

When a turn changes files, commit the changes before you give control back to the user.

- Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<optional scope>): <summary>`.
  For example, `feat(story): add story create command` or `fix(tui): keep focus after closing a modal`.
- The usual types are `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build` and `ci`.
- Mark a breaking change with `!` (`feat!: …`) or with a `BREAKING CHANGE:` footer.
- Keep the summary short. Write it in the imperative and in lower case, with no period at the end.
- Add a body if the reason for the change is not clear from the summary.
- Commit only the changes that you made in that turn. Stage each file by its name. Do not use
  `git add -A`.
- Do the checks in [AGENTS.md](../../AGENTS.md#checks-before-you-complete-a-change) first. If they fail
  and you cannot repair the problem, tell the user. Do not commit code that does not work.
- Do not push, amend or rewrite the history if the user does not tell you to do it.

## Related

- [AGENTS.md](../../AGENTS.md#commits): the short form of these rules.
