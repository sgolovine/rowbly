#!/usr/bin/env sh
# Builds the demo Data Root that TUI screenshots are taken against
# (.agents/skills/rowbly-screenshots/SKILL.md): one Board with two Stories in each
# default Stage, Assignees, Tasks and a Comment. It runs the built CLI, so run
# `pnpm build` first. The target directory must not exist yet.
set -eu

root=${1:?usage: scripts/demo-data-root.sh <new-directory>}
cli="$(cd "$(dirname "$0")/.." && pwd)/dist/cli.js"
# A throwaway home folder, so the demo is not recorded in your ~/.rowblyrc.json.
home=$(mktemp -d)
trap 'rm -rf "$home"' EXIT

rowbly() {
  HOME="$home" node "$cli" --data-root "$root" --no-prompt "$@" >/dev/null
}

rowbly init --board launch --board-name "Rowbly Launch" --prefix ROW
rowbly whoami --local alex   # local Me, so the demo leaves ~/.rowblyrc.json alone
for plugin in assignees tasks comments; do
  rowbly plugins enable "$plugin"
done
rowbly assignees add alex --name "Alex Rivera"
rowbly assignees add sam --name "Sam Chen"

story() {
  rowbly stories create --name "$1" --stage "$2" --priority "$3" --assignee "$4" --label "$5" \
    --description "$6"
}
story "Keyboard navigation audit" backlog P2 sam accessibility "Walk every screen with the keyboard only."
story "Add saved Board filters" backlog P3 alex enhancement "Keep a filter between launches."
story "Polish first-run experience" todo P1 alex onboarding "Make the first screen explain the next step."
story "Document Plugin examples" todo P2 sam docs "Add a worked example for each Built-in Plugin."
story "Capture TUI screenshots" in-progress P1 alex devtools "$(printf '%s\n' \
  'Capture the TUI with agentic-tui for docs and pull requests.' '' \
  'Acceptance criteria:' \
  '- Screens are captured from a real terminal' \
  '- The capture is repeatable from a script')"
story "Review storage recovery" in-progress P0 sam reliability "Replay an interrupted commit journal."
story "Ship Comments Plugin" done P2 alex plugins "Comments on Stories."
story "Add Stage colour hints" done P3 sam design "Colour Stage headers by Stage Category."

rowbly tasks create ROW-5 --name "Capture a populated Board" --stage done
rowbly tasks create ROW-5 --name "Capture Story details and Tasks" --stage in-progress
rowbly tasks create ROW-5 --name "Try a narrower terminal" --stage todo
rowbly comments add ROW-5 --body "Screenshots come from agentic-tui running the built CLI."
