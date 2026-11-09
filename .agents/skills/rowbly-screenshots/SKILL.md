---
name: rowbly-screenshots
description: >
  Take screenshots of the Rowbly TUI or CLI with agentic-tui. Build the CLI, run it in a PTY,
  operate the screens with keys and save PNG and text captures. Use this skill for each request for
  a screenshot, screen capture or picture of Rowbly, for screenshots for a pull request, and to
  examine a TUI layout change in a real terminal.
---

# Rowbly screenshots

Make each screenshot of Rowbly from the real built CLI. Run the CLI in a PTY and operate it with
[agentic-tui](../agentic-tui/SKILL.md). Do not draw screens by hand. Do not show an
`ink-testing-library` frame as a screenshot.

## Setup

Run these commands from the root of the repository. Use absolute paths for all files. The
agentic-tui daemon keeps the working directory of its first start. If you use a relative
`dist/cli.js`, the daemon can run the build of a different checkout.

```bash
repo="$(pwd)"
out="$(mktemp -d)"            # captures stay outside the repository
mkdir "$out/agentic-tui-state" "$out/home"
export AGENTIC_TUI_STATE_DIR="$out/agentic-tui-state"   # a daemon of its own, never a shared one
pnpm build
t() { pnpm -s exec agentic-tui --session-namespace rowbly-screenshots "$@"; }
t run node "$repo/dist/cli.js" --cwd "$out" --cols 140 --rows 38 --env HOME="$out/home"
```

`HOME` points to an empty folder. Because of this, the CLI does not read or change the files in the
home folder of the user.

In zsh, `t() { … }` fails if an alias with the name `t` exists. In that case, use a different name.
Or set `A="pnpm -s exec agentic-tui --session-namespace rowbly-screenshots"` and call `$=A`.

## Capture

Do these steps for each screen:

1. Send one key with `t press <Key>`, for example `Enter`, `Escape`, `Tab`, an arrow or `Ctrl+S`.
   For a printable key such as `?` or `,`, use `t type '<char>'`. Put quotes around the key, because
   zsh expands a `?` without quotes. Send more than one key in one `press` only if the screen does
   not change between the keys.
2. Wait for text that only the new screen shows. Then wait until the screen is stable:
   `t wait "<text>" --timeout 5000` and `t wait --stable --timeout 2000`. Text from the previous
   screen, or text that stays visible behind a modal, matches immediately and proves nothing. Footer
   hints are good markers. A screen with a `Spinner` does not become stable, so do not use `--stable`
   on that screen.
3. Read `t screen` and make sure that the correct item is selected. Then save the two forms:

   ```bash
   t screenshot --out "$out/01-screen.png" --format png
   t screenshot --out "$out/01-screen.txt" --format text
   ```

For a different terminal size, start a new run with different `--cols` and `--rows` values. Do not
use `t resize`, because the capture after a resize can keep characters from the old right edge.

At the end, run `t kill`. Then run `t daemon stop` with the same `AGENTIC_TUI_STATE_DIR`. Do not stop
a daemon that was there before, a shared daemon or the default daemon. Show each PNG to the user as a
Markdown image with its absolute path.

## Limits

The PNG shows the text grid in one colour. It does not show colours, bold text, fills or the caret.
Some glyphs, for example box-drawing joins and `✓`, do not render correctly. The text capture is
exact. If the request is about colour or style, tell the user about these limits.

## In a pull request

Image links in a PR body must point to files that GitHub serves. Push the PNGs to a branch that
contains only assets. Do not push them to the branch of the PR or to `main`. Link the raw files:

```bash
git worktree add --orphan -b pr-assets/<pr-branch> "$out/assets"
cp "$out"/*.png "$out/assets/" && git -C "$out/assets" add . &&
  git -C "$out/assets" commit -m "docs: screenshots for <pr-branch>" &&
  git -C "$out/assets" push -u origin pr-assets/<pr-branch>
git worktree remove "$out/assets"
# ![Screen](https://raw.githubusercontent.com/<owner>/<repo>/pr-assets/<pr-branch>/01-screen.png)
```

Keep the `pr-assets/<pr-branch>` branch after the PR merges or closes. The comments of the PR link
to these files by the branch name. Delete the branch only if the user tells you to delete it.
