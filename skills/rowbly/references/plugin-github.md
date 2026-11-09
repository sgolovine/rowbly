# GitHub Plugin

Every command takes `--json --no-prompt`. The Plugin id is `github`; it has no settings.

```sh
rowbly plugins enable github --json --no-prompt
rowbly stories create --board web --name "Sign in" --github-pr https://github.com/octo/app/pull/123 --json --no-prompt
rowbly stories edit WEB-1 --github-pr https://github.com/octo/app/pull/123 --json --no-prompt
rowbly stories edit WEB-1 --github-pr '' --json --no-prompt
rowbly github status WEB-1 --json --no-prompt
```

Set the field when opening a Story's PR; assigned workers report the edit to their supervisor.
The URL is HTTPS with exactly `/owner/repository/pull/<positive integer>` and an optional trailing
slash, no credentials, ports, query/fragment, dot segments or encoded path parts. The host is
lowercased and the trailing slash removed. Enterprise hosts are accepted with existing gh access.
`stories show` and Story Context expose the stored link without contacting GitHub.

`github status` calls installed/authenticated `gh` once; it never installs tools or starts login.
No link: exit 3. Invalid/future data: exit 6, unchanged; even explicit clearing/replacement refuses
an opaque bag. Doctor's `PLUGIN_DATA_INVALID` warns without a fix. Ask for repair, never overwrite.
Missing gh, failed access/authentication, invalid output, timeout or output overflow report errors.
The host bounds a read to 10 seconds, 1 MiB stdout and 64 KiB stderr, and cancels it on teardown.

The JSON result has `pr`, `number`, `title`, `url`, `state`, `isDraft`, `mergeable`, `mergeStateStatus`,
optional `reviewDecision`, `checks: { total, passed, failed, pending, other }` and `fetchedAt`.
No reported checks, pending checks or `other` conclusions are not proof of success. A saved PR URL
proves no check/review conclusion, branch/head identity or worker provenance; verify those separately.
The Story bag is strict unversioned v1 `{ "pr": "<url>" }`; unrelated core edits preserve opaque bags.

The TUI form adds **GitHub PR**. Its Story tab fetches immediately, every 60 seconds while active,
and with `r`; errors label the last result as stale. It cancels on leaving/teardown and saves no status.

## Board Stats

`rowbly boards stats [id] --json --no-prompt` includes GitHub metrics `linked-prs` and `commits`.
They count unique PR identities currently linked to existing Stories on that Board, and unique full
commit SHAs in those PRs, across all time. All PR lifecycle values count. No unlinked history or
repository-wide commits are inferred. GitHub must be on and gh authenticated for each host.
Equivalent links/returned PR identities and SHAs are deduplicated. Invalid bags remain unchanged.

A source is complete, partial (validated known lower bound) or unavailable (null), with reasons.
Only a complete empty source is an exact zero. Refresh caps: two requests concurrently, 100 candidate
PRs, 100 commits/page, 10 pages/PR, 200 pages overall, 30 seconds. Changed, unreadable or incomplete
PR commit lists are excluded. No retries, saved analytics or background polling. The TUI shows the
same metrics on Board Stats; r refreshes and page teardown cancels requests.
