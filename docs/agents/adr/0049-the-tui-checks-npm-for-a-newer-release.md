# ADR-0049: The TUI checks npm for a newer Rowbly release when it starts

**Status:** Accepted.

Rowbly is installed with `npm i -g rowbly` and has no way to tell people that a newer release
exists. Until now its only network traffic was the `git` commands that the Git Plugin runs to sync.

## 1. What is checked

When `rowbly` opens the TUI, it reads the manifest of the `latest` release from
`https://registry.npmjs.org/rowbly/latest` and compares its `version` with the running one by
major, minor and patch. Only a newer stable release counts; a prerelease, an older release or an
answer in another form does not. Rowbly sends nothing about the person or their Data Root, and it
installs nothing.

Commands (`rowbly <noun> <verb>`), `--json`, `--no-prompt` and a bare `rowbly` without a terminal
make no request and print nothing new, so scripts and agents see no change. `ROWBLY_NO_UPDATE_CHECK=1`
turns the check off; the demo (`ROWBLY_TUI_DEMO=1`) skips it.

## 2. The check never delays Rowbly

The check starts beside the TUI and nothing waits for it. Being offline, an error, an unexpected
answer or no answer within 3 s ends it with nothing shown. Its socket and timer are unreferenced and
quitting destroys the request, so a check still running never keeps Rowbly from exiting.

## 3. Where it shows

A newer release adds one row above the footer's keys, right-aligned: `Rowbly <version> is
available, update with npm i -g rowbly`, the command styled like a key. On a narrow terminal it
shortens to `Rowbly <version>: npm i -g rowbly`. The main area gives up the row, so the key hints
keep their width. The row stays for the session.

## 4. Rejected alternatives

- Checking on every command would add a request and a delay to every script and agent call, and
  output that `--json` callers do not expect.
- A Toast goes away after a few seconds and is for the result of an Operation.
- Replacing the version in the footer leaves too little room for the key hints at 80 columns.
- Caching the last result in the Home Config would add writes and settings for a request that
  costs about 2 KB once per TUI start.
- Updating Rowbly itself would need to know how it was installed; the notice gives the command.
