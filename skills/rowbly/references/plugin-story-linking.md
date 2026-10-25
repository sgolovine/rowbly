# Story Linking Plugin

Every command below takes `--json --no-prompt`. Removing a link also needs `--yes`.

Story Linking records which Stories block other Stories on the same Board. It is off until
`rowbly plugins enable story-linking`. A Story can block several Stories and be blocked by several
Stories at once. Links do not restrict Stage changes; opposing links and cycles are allowed.

## Commands

```sh
rowbly plugins enable story-linking --json --no-prompt
rowbly story-linking add WEB-1 --blocks WEB-2 --json --no-prompt
rowbly story-linking add WEB-3 --blocked-by WEB-1 --json --no-prompt
rowbly story-linking list WEB-1 --json --no-prompt
rowbly story-linking list WEB-2 --json --no-prompt
rowbly story-linking remove WEB-2 --blocked-by WEB-1 --yes --json --no-prompt
rowbly story-linking remove WEB-1 --blocks WEB-3 --yes --json --no-prompt
```

- `add` and `remove` need exactly one of `--blocks <KEY>` or `--blocked-by <KEY>` (otherwise exit 2).
  Story Keys are case-insensitive and need no `--board`.
- `add` requires two existing Stories on the same Board. A cross-Board link or a self link exits 2;
  a missing Story exits 3. Adding an existing link succeeds without changing data.
- `list` returns an array of `{ relation, key, name, available }`. `relation` is `blocks` or
  `blocked-by`, relative to the requested Story. A missing target has `name: null`, `available: false`.
- `add` and `remove` return `{ blocker, blocked }` with canonical Story Keys. Removing from the
  blocked Story edits the blocking Story's outgoing links. Both views update from that one change.
- Removing a missing link exits 3. An outgoing link to a deleted Story can still be removed: use
  `remove <existing blocker> --blocks <missing KEY>`.
- `stories show` adds **Blocks** and **Blocked by** rows. Its JSON is the stored Story; use
  `story-linking list` for derived incoming links.

## Data and preservation

Only the blocking Story holds the relationship:
`"plugins": { "story-linking": { "blocks": ["WEB-2", "WEB-3"] } }`.
Incoming links are derived from the same Board's Stories. A change stamps the blocker's `updatedAt`;
removing its last outgoing link removes this Plugin's bag. Other Plugin Data is preserved.

While enabled, deleting a Story removes its incoming references in the same atomic change.
Turning the Plugin off keeps all its data; its commands and TUI tab disappear. Core edits keep
the bags while it is off. Re-enable it to see the saved links again.

If a target was deleted while the Plugin was off, its links remain until removed or repaired.
Story Keys can be reused after deletion, and doctor can renumber colliding Stories after a merge.
The Plugin cannot infer which Story an old key meant; inspect and correct links after such changes.

## Doctor and invalid data

- `STORY_LINKING_INVALID_TARGET` (warning): a valid bag names a missing Story, a Story on another
  Board, or itself. `doctor --fix` removes those links atomically, preserving other Plugin Data.
- `PLUGIN_DATA_INVALID` (warning): a bag fails its schema, including unknown fields. It is never
  replaced with an empty bag. Mutations of that bag exit 6 and save nothing; correct it using the
  [doctor workflow](doctor.md).
- `list` exits 6 if any Story on the Board has an invalid linking bag, since it may conceal incoming
  links. The TUI shows readable links with an incomplete-data warning. Story deletion also exits 6
  when an invalid bag on the Board prevents safe incoming-reference cleanup.

## TUI, for the user

Open a Story's **Links** tab. Each row says **Blocks KEY** or **Blocked by KEY** and shows the linked
Story's name. `↑`/`↓` selects, `enter` or a click opens that Story, and `esc` returns. `/` filters the
rows. `n` opens a new-link form with a relationship direction and Stories on this Board; `ctrl+s`
adds it. `d` removes the selected relationship after confirmation (`y` confirms, `n` cancels).

Story creation accepts repeatable `stories create --blocks <KEY>` and `--blocked-by <KEY>`. Targets must exist on the same Board; missing or cross-Board targets are `VALIDATION` (exit 2) and save nothing. The Links create tab collects both directions with `n`. Existing blockers' bags update atomically with the new Story, Tasks and Spec files.
