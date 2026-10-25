# Attachments Plugin

A PNG Attachment belongs to a Story. Enable with `rowbly plugins enable attachments` only when the
request needs it; say that you changed shared configuration. Disabling keeps entries and PNGs.
Every command takes `--json --no-prompt`; removal also needs `--yes`, only when explicitly requested.

```sh
rowbly attachments add WEB-42 /tmp/image.png --json --no-prompt
rowbly attachments add WEB-42 --from-clipboard --json --no-prompt
rowbly attachments list WEB-42 --json --no-prompt
rowbly attachments remove WEB-42 <id> --yes --json --no-prompt
rowbly attachments open WEB-42 <id> --json --no-prompt
```

Give a file or `--from-clipboard`, never both. File input keeps its basename; clipboard input uses
`image-YYYYMMDD-HHMM.png` in UTC. Input must have a PNG signature and be at most 10 MiB.
A clipboard failure reports `unsupported`, `no-display`, `no-image`, `too-large` or `timeout`;
report the reason without retrying in a loop. Nothing is saved on failure.

`list` returns an array in insertion order. Each entry has `id`, `name`, `type` (`image/png`), `size`
(bytes), `createdAt` and `createdBy` (Me or `null`). `add` returns one entry; `remove` returns
`{ removed }`; `open` returns `{ opened }`. Get ids from add/list. `open` requires the platform's
associated application (`open`, Windows `start`, or `xdg-open`). The TUI tab and paste handling are planned.

Entries live in `plugins.attachments.attachments` in `story.json`; PNGs live at
`boards/<board>/stories/<KEY>/plugins/attachments/<id>.png`. Add/remove updates both in one atomic
Operation; doctor renumbering moves PNGs with the Story. Never edit entries or bytes by hand.

Doctor reports `ATTACHMENTS_MISSING_FILE` for dangling entries; `--fix` removes those entries from
valid bags. `ATTACHMENTS_ORPHAN_FILE` preserves unreferenced bytes for recovery, including with
`--fix`. Invalid bags receive `PLUGIN_DATA_INVALID` and no repair. Owner reads and changes exit 6;
never overwrite unreadable data with an empty bag. Preserve the bytes and report the problem.

In the TUI, paste with Ctrl+V, Alt+V, Ctrl+Alt+V or empty bracketed paste on any Story tab or
new/edit form. Open Stories save immediately. Forms hold images in memory until save (10 MiB total),
show an Attachments summary on Details/in the edit form, preserve failed saves, and confirm discard.
The Attachments tab lists name, size and date: n new Attachment from PNG path, o open, d remove
with confirmation. Story/card badges use the stored count. SSH/headless fallback: rowbly attachments add <KEY> <file>.
