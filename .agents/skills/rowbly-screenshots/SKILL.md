---
name: rowbly-screenshots
description: >
  Take screenshots of the Rowbly TUI or CLI with agentic-tui: build the CLI, create the demo Data
  Root, drive the screens with keys and save PNG and text captures. Use for every request for a
  screenshot, screen capture or picture of Rowbly, including screenshots for a pull request.
---

# Rowbly screenshots

Screenshots of Rowbly come from the real built CLI running in a PTY driven by
[agentic-tui](../agentic-tui/SKILL.md). Do not hand-draw screens or present an
`ink-testing-library` frame as a screenshot.

## Setup

Run from the repository root. Use absolute paths everywhere: the agentic-tui daemon keeps the
working directory it was first started in, so a relative `dist/cli.js` can run another checkout's
build.

```bash
repo="$(pwd)"
out="$(mktemp -d)"            # captures and the demo Data Root stay outside the repository
pnpm build
scripts/demo-data-root.sh "$out/rowbly-demo/.rowbly"   # the header shows `rowbly-demo`
t() { pnpm -s exec agentic-tui --session-namespace rowbly-screenshots "$@"; }
mkdir "$out/home"              # a home folder of its own, so ~/.rowblyrc.json is not touched
t run node "$repo/dist/cli.js" --cwd "$out/rowbly-demo" --cols 140 --rows 38 --env HOME="$out/home"
t wait "v list view" --timeout 10000
```

`scripts/demo-data-root.sh` creates one Board, `launch` (`ROW`), with two Stories in each Stage,
the Assignees, Tasks and Comments Plugins turned on, and Me set to `alex`. `ROW-5` is in In Progress
and has Tasks and a Comment. Use another Data Root only when the user asks for one; never point the
TUI at the repository's own `.rowbly/`.

## Capture

For each screen:

1. Send one key with `t press <Key>`, or `t type '<char>'` for a printable key such as `?` or `,`
   (quote it: zsh expands a bare `?`). Send several keys in one `press` only when no screen change
   happens between them.
2. Wait for text that only the destination shows, then for the screen to settle:
   `t wait "<text>" --timeout 5000` and `t wait --stable --timeout 2000`. Text that was already on
   screen, or that stays visible behind a modal, matches at once and proves nothing; footer hints
   such as `v Stages view` or `c add Comment` are good markers.
3. Read `t screen` to check that the right item is selected, then save both forms:

   ```bash
   t screenshot --out "$out/01-board.png" --format png
   t screenshot --out "$out/01-board.txt" --format text
   ```

Useful routes from the board (it opens with ROW-1 selected):

| Screen | Keys | Wait for |
| --- | --- | --- |
| Board, list view | `v` | `v Stages view` |
| Story `ROW-5` | `ArrowRight`, `ArrowRight`, `Enter` (one at a time) | `Capture the TUI with agentic-tui` |
| Story › Tasks, › Comments | `Tab` | `Capture a populated Board`, `c add Comment` |
| Keys help | `?` | `─Keys─` (the modal title) |
| Settings | `,` | `Board › Settings` |

For another terminal size, start a new run with other `--cols`/`--rows` rather than `t resize`:
the resized capture can keep characters from the old right edge.

Finish with `t kill`. Show each PNG to the user as a Markdown image with its absolute path.

## Limits

The PNG is the text grid drawn in one colour: Stage colours, bold and the selection highlight are
lost, and some glyphs (box-drawing joins, `✓`) render imperfectly. The text capture is exact. Say so
when the request is about colour or styling.

## In a pull request

Image links in a PR body must point at files GitHub serves. Push the PNGs to a branch that holds
only assets, never to the PR's branch or `main`, and link the raw files:

```bash
git worktree add --orphan -b pr-assets/<pr-branch> "$out/assets"
cp "$out"/*.png "$out/assets/" && git -C "$out/assets" add . &&
  git -C "$out/assets" commit -m "docs: screenshots for <pr-branch>" &&
  git -C "$out/assets" push -u origin pr-assets/<pr-branch>
git worktree remove "$out/assets"
# ![Board](https://raw.githubusercontent.com/<owner>/<repo>/pr-assets/<pr-branch>/01-board.png)
```
