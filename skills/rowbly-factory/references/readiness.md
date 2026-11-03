# Advisory readiness passes

A Stage Prompt can review readiness without moving the Story or authorizing implementation. It
reports one Comment with concrete questions or missing requirements and finishes its Stage Run in
the same Stage. A finished Run prevents another automatic pass during that visit. Comments, Specs,
Tasks and requirement edits do not clear it. Only a person requests another pass with
`rowbly software-factory run clear <KEY> --json --no-prompt` after providing new input; moving out
and returning also creates another visit. The supervisor never clears a finished Run to repeat it.

Use the [fingerprint helper](../scripts/readiness-fingerprint.mjs) when the Stage Prompt also needs
to suppress duplicate output after a cleared Run. Keep the prompt, its input contract and this
helper together. The helper reads only; it never starts or clears a Run, adds a Comment or moves a
Story. Rowbly's CLI does not enforce this readiness policy.

## Collect and compare

Run from a clean Git repository root. Node 22+, Git and the named Rowbly command must be available.
Pass the Data Root explicitly and command arguments as separate arguments after `--`; no shell,
`RB` string, `jq` or `sha256sum` is involved:

```sh
node <skill-folder>/scripts/readiness-fingerprint.mjs WEB-42 /path/to/.rowbly
node <skill-folder>/scripts/readiness-fingerprint.mjs WEB-42 /path/to/.rowbly -- pnpm --silent dev
```

Success exits 0 and prints `method=2`, the 14 input hashes below, `overall`, and
`comparison=equal|changed|unknown`. Hashes are full SHA-256 over canonical JSON: object keys sorted,
array order retained except Comments ordered by `createdAt` then `id`. The helper's contents are
also an input, so a helper change requires another review.

| Input | What it covers |
| --- | --- |
| `helper` | This helper's complete contents. |
| `repository` | Tracked Git tree entries outside `.rowbly`; uncommitted or untracked review inputs are a gap. Board-only publication commits do not change this input. |
| `plugins` | Every known Plugin's id, enabled and loaded values. |
| `configuration` | The Board's complete effective `config show` result, including Stage Categories and Custom Fields. |
| `story` | The Story and known Plugin bags, excluding rank, Story `updatedAt`, the recognized Stage Run and generated readiness Comments; an emptied Comments bag is removed. |
| `comments` | All ordinary Comments in full, including edits to older Comments. |
| `specs` | Full Story Specs and every linked Board Spec. |
| `tasks` | Full Task list. |
| `links` | Both link directions, availability, and each blocker's current Stage and Stage Category. |
| `epic` | The linked Epic's id, name, description and closed value; unrelated Epic progress and its Story lists are excluded. |
| `attachments` | Attachment metadata and each image's bytes. |
| `assignees` | The Assignee roster; Story assignments are also in `story`. |
| `prompt` | This Stage's complete effective prompt result, including its text. |
| `guide` | The Data Root's own `ROWBLY.md` bytes, or a distinct absent marker. |

Disabled Plugins without stored Story data contribute a hashed `off` marker. No linked Epic
contributes a hashed `none` marker. Comments and Software Factory must be on. An unknown Plugin,
Story bag or field in a known bag is a gap until its input contract is reviewed. A disabled Plugin
with a stored Story bag is also a gap: preserving its data does not prove that its external inputs
were reviewed. Never turn it on merely to make a fingerprint succeed.

Every command must exit successfully and return exactly one JSON value of the expected shape.
Missing tools, failed commands, malformed JSON, nonfinite values and unreadable inputs produce
exit 1 and only `gap=<input>: <reason>`; no partial hashes or `overall` are printed. Invalid
arguments exit 2. If Node itself is unavailable, report that the helper could not run as a gap.
`ROWBLY.md` and Attachment images must be own regular files with no symlink path components.
Only an absent guide is accepted as absent; a symlink, directory, unreadable file or changed file
identity is a gap. A present empty guide differs from an absent one.

The helper compares only the newest Comment whose body starts `Readiness review `. Reserve that
prefix for generated reviews; answers and new requirements use ordinary Comments. The prior
record must have exactly the known method-2 fields, unique names, full hashes and a correct
recomputed `overall`. Missing, duplicate or unknown fields, a different method or incomplete
record gives `comparison=unknown`, never equal. A valid prior record with changed inputs gives
`changed`; only two complete matching fingerprints give `equal`.

## Report a pass

Read all the inputs and relevant repository material. With `comparison=equal`, report the prior
review's id/date to the supervisor, add no Comment and finish the Run without moving. Otherwise
review again and identify answered, open and new questions. Run the helper again after research
and reconcile any changed inputs before reporting. Any additional review input the helper cannot
cover is a gap: do not skip or call that review complete, even if the helper reports equal.

Put one readiness Comment in the worker's reported block. Its body is one physical line, quoted
according to the worker brief. Join only the helper's lines from `method=2` through `overall` with
spaces; do not copy `comparison`. Delimit the fingerprint with ` | ` exactly as below:

```text
Readiness review <UTC date>. Verdict: <Needs answers or Ready for a person to decide> | Questions: <concrete questions or none>; Missing: <requirements or evidence>; Changed: <inputs and resolved/open questions, or first/full review> | Reviewed input (method 2): <method/hash lines joined with spaces> | Advisory only; this does not authorize implementation. A person decides when to move the Story.
```

For a gap, replace the fingerprint with `INCOMPLETE; <gaps>`, include no `overall`, record
`Needs answers` and name what could not be read. Never substitute an empty value or infer a
Plugin is off from a failed read. If the Story itself cannot be read, ask the supervisor and wait
instead of inventing a review. Otherwise questions belong in the Comment: finish the advisory
Run, leave the Story in place and do not authorize implementation.
