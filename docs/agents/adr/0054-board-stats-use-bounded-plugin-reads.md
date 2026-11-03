# ADR-0054: Board Stats use current records and bounded Plugin reads

**Status:** Accepted. Built for ROW-70. Amends [ADR-0051](0051-plugins-use-fixed-host-external-reads.md) §1–2.

## 1. Meaning and ownership

Board Stats are all-time counts of current records: existing Stories and Stories currently in a
Stage of category `done`. Deleted Stories and historical Stage transitions are excluded. One
coordinated snapshot reads the Board, effective Stages, Stories and enabled Plugin entries. Its
lock closes before any Plugin code or external read runs. Collection refuses a caller-held read
scope or Plugin callback rather than extending that lock across network work.

An optional `boardStats` declaration names a Plugin's metrics and collector. Core knows their keys,
labels and complete/partial/unavailable results, not their domain meaning or bags. Collectors get
detached deeply frozen Board/Story copies and only their own `inspectBag`, declared `externalRead`
and `externalReadSignal`. The dedicated `board-stats` execution scope allows external reads but
not mutations, Git effects or nested collection. Retained contexts do not bypass that scope.
Cancellation, host disposal and the 30-second collector deadline revoke its reads and execution
scope. These are safeguards for trusted in-process Plugins, not a sandbox.

Declared labels remain visible when their Plugin is Off or fails. Complete values are exact counts;
partial values are validated known lower bounds with a reason; unavailable values are `null` with
a reason. Collection persists nothing. CLI and TUI use the same helper; TUI refresh is manual.

## 2. GitHub source and bounds

The GitHub Plugin counts unique PRs currently linked to the Board's Stories and unique full commit
SHAs in those PRs. It normalizes equivalent URLs before reading, then deduplicates PR identities
by host and returned node ID (including linked aliases), and commit SHAs across completed PRs.
Unreadable links remain unchanged and make the source incomplete. Unresolved identities are never
assumed distinct. No links with all bags readable is an exact zero; an unavailable source is not.

`gh-pr-commits` is one additional fixed host template. Only `url` and optional `after` are accepted.
Storage validates the HTTPS PR URL and a 1–512 character base64/base64url cursor and constructs a
constant `gh api graphql` invocation, with the URL's host/account/repository/number as variables.
It asks only for PR ID, canonical URL, head SHA, and 100 commit SHAs with `totalCount` and
`pageInfo`. No executable, endpoint, query, pagination option or arbitrary argv comes from a Plugin.
`gh-pr-view` is unchanged. GraphQL errors, missing data, invalid SHAs, repeated/nonadvancing cursors,
changed identity/head/count or a final count mismatch refuse that PR's commit contribution.

A refresh has at most two requests in flight, 100 candidate PRs, 10 pages per PR, 200 pages overall
and 30 seconds. Initial pages precede continuations so one large PR cannot starve other identities.
Existing per-process bounds remain: 10 seconds, 1 MiB stdout, 64 KiB stderr, two active processes,
eight queued calls and cancellation with SIGTERM/SIGKILL cleanup. Caps or failures produce partial
or unavailable results, never estimated totals. There are no retries, saved results or background
polling. GitHub reads are live and are not an atomic snapshot with local records or other PRs.

## 3. Alternatives and checks

Rejected: inferring completion dates from `updatedAt`, reconstructing deleted history, counting
all repository commits, letting core inspect GitHub bags, a new analytics store, arbitrary GraphQL
access, or treating truncated lists as complete. The REST PR-commits endpoint is capped at 250;
the fixed GraphQL connection exposes pagination and a count to check completeness.

The kept Plugin loading/capability tests cover declaration validation, fixed invocation, refused
arguments/scopes, immutable inputs, lock release, identity/SHA deduplication, pagination,
partial/unavailable output and preservation. The kept CLI scenario checks Board isolation and
current Done counts. No test count increase is needed.
