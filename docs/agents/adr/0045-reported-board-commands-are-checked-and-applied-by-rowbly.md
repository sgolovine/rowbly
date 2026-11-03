# ADR-0045: Rowbly checks a worker's reported Board commands and applies them through the CLI

**Status:** Accepted; amends ADR-0040

## 1. Context

Factory workers do not write the Board (ADR-0040 §2). They report the `rowbly` commands their Stage
Prompt asks for in a fenced `rowbly` block, and the supervisor applies them. Until now the
supervisor checked each line against prose rules in the `rowbly-factory` skill and ran it by hand:
an agent's reading of quoting, of which Story a line changes and of when a move may run. A
misreading could change another Story, run shell syntax, end a Stage Run that the supervisor owns,
or move the Story while its Stage Run was still running.

## 2. Decision

1. **A checked allowlist.** `rowbly software-factory apply <story>` reads the block (the lines inside
   ```` ```rowbly ```` fences, else every line) and decides each line:
   - It is split with POSIX quoting and no shell. A line with a shell metacharacter outside single
     quotes, `$` or a backtick inside double quotes, or an open quote is rejected.
   - It must start with `rowbly` and be one of the commands about one Story: `stories edit|move`,
     `comments add|edit`, `tasks create` and `tasks edit|move` of its Tasks, `specs create|edit
     --story`, and `story-linking add|remove --blocks`. The Story must be the command's first
     argument (a Task id's prefix, or `--story` for Specs) and the Story given to `apply`, and the
     command must write only that Story. Story Linking stores a link on the blocking Story, so
     `story-linking add|remove --blocked-by` (with a space or `=`), which writes the other Story, is
     rejected.
   - `software-factory` commands are rejected: Stage Runs are the supervisor's. So are options the
     supervisor sets or that read its own files or open an editor (`--data-root`, `--board`, `--yes`,
     `--prompt`, `--edit`, `--*-file`, `--story-spec`, `--from-clipboard`), `--finished-run` (which
     `apply` sets itself), short options and `--`.
   - When any line is rejected, nothing runs: `apply` exits 2 and lists every line's decision, so the
     supervisor can ask the user and submit the allowed lines again on purpose.
2. **Moves wait for the Stage Run.** A `stories move` runs only when the Story's Stage Run for this
   visit is `finished`. It is held, and reported as held, while the Stage Run runs or when there is
   none; it is dropped after a `failed` Stage Run. Moves run after the other lines, and a block holds
   at most one. The supervisor finishes or fails the Stage Run first, then applies the final block.

   The decision is checked again when the move is saved, not only when `apply` reads the Story: the
   Run can be cleared or replaced while earlier lines run. `apply` runs the move with
   `--finished-run <stage>/<attempt>/<startedAt>`, the Run it decided on. Software Factory takes that
   option on `stories move` as its input of `stories.move`, and its `stories.move` guard reads the
   Story as stored when the move took the Data Root lock, after every transform. Unless that Run is
   still the visit's `finished` Stage Run, with the same Stage, attempt and start, the move is refused
   (`CONFLICT`) and nothing is saved. A move without the option is unchanged. Core learns no Plugin
   term: this is an ordinary Plugin option and guard.
3. **Applied through the CLI.** Each allowed line runs as its own `rowbly` child process with the
   opened Data Root and `--json --no-prompt`, through `PluginCommandEnv.runCommand`. The host pins
   those options and refuses a caller's `--data-root`, `--json`, `--yes`, `--prompt`, `--help` and
   short options; a child cannot run children. `apply` holds no lock and runs no operation of its
   own; each child operation takes the Data Root lock, and the Git Plugin commits it as usual.
4. **Partial success is reported.** Lines run in order and the first failure stops the block. The
   lines before it stay applied; the error, with the failed command's code, lists each line's
   outcome. `--dry-run` only decides the lines and changes nothing.

## 3. Rejected alternatives

- **Validate only, and let the supervisor run the commands.** The agent would quote each argv for a
  shell again, which is the risk this removes.
- **Run the allowed lines and report the rejected ones.** A partly applied block is harder to reason
  about than a refused one; the supervisor can resubmit the allowed lines.
- **Run the commands in-process.** A Plugin cannot reach other Plugins' commands through the Plugin
  API, and the child keeps each command's validation, hooks, lock and commit exactly as a person's.
- **Check the Stage Run again in `apply` before the move.** A second read outside the move's lock
  still leaves a window in which the Run is replaced; only the move's own operation sees the Story
  as it saves it.
- **Accept options by their arity.** The commands' options change with the Plugins on; requiring the
  Story first and refusing a short denylist of options keeps the check independent of them.
