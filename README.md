<p align="center">
  <img src="https://raw.githubusercontent.com/sgolovine/rowbly/main/assets/icon.png" alt="Rowbly icon" width="120" height="120">
</p>

<h1 align="center">Rowbly</h1>

<p align="center">
  A file-backed Kanban board for you and your agent, right in your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/rowbly"><img alt="npm version" src="https://img.shields.io/npm/v/rowbly?style=flat-square&color=f5b942"></a>
  <a href="https://github.com/sgolovine/rowbly/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/sgolovine/rowbly/ci.yml?branch=main&style=flat-square&label=ci"></a>
  <img alt="License: MIT" src="https://img.shields.io/npm/l/rowbly?style=flat-square">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/user-guide.md">User guide</a> ·
  <a href="docs/plugins/built-in.md">Plugins</a> ·
  <a href="docs/README.md">How it's built</a>
</p>

Rowbly keeps all of its data in your repository, committed just like your code. Changes to Stories go
through the same branches, reviews and merges as everything else, with no server to run and no account to
create. It is easy for people to use, and even easier for agents.

Work on a full-screen Kanban board in the terminal, or run one command at a time. Both do the same things,
and every list and show command can print JSON, so scripts and coding agents can use Rowbly too.

Rowbly is meant for one person or a small team that already shares a repository, and it works just as well
for one person working with a team of agents. It has no accounts, permissions or web interface: anyone who
can read the repository can read the Board.

## Install

Rowbly needs Node.js 22.12 or newer.

```sh
npm install -g rowbly
```

With pnpm, use `pnpm add -g rowbly`. Check the install with `rowbly --version`.

## Quick start

In the repository you want to track:

```sh
rowbly init --board web --board-name Website --prefix WEB
rowbly whoami ada
rowbly stories create --name "Password reset" --priority P1 --label auth
rowbly
```

1. `init` creates `.rowbly/` with one Board, `web`, whose Stories are keyed `WEB-1`, `WEB-2`, and so on.
   Run `rowbly init` without flags to be asked for these values instead.
2. `whoami` sets Me, the handle Rowbly records as the creator of your Stories. Use your own.
3. `stories create` adds `WEB-1` to the Backlog.
4. `rowbly` with no command opens the board.

`.rowbly/`, the Data Root, is a handful of small files:

```text
.rowbly/
  rowbly.config.json            # Stages, Custom Fields and Plugins for every Board
  .gitignore                    # keeps local.json out of git
  local.json                    # your Me and current Board
  boards/web/
    board.config.json           # the Board's name and key prefix
    stories/WEB-1/story.json    # one Story
```

Commit it like any other code:

```sh
git add .rowbly
git commit -m "Track work with Rowbly"
```

Anyone who pulls gets the same Board. Each person runs `rowbly whoami <handle>` once.

## Rowbly and git

Each Story is its own file, so changes to different Stories merge without conflicts. Moving a Story shows
up in git as one changed file:

```console
$ rowbly stories move WEB-1 in-progress
Moved WEB-1 to in-progress

$ git status --short
 M .rowbly/boards/web/stories/WEB-1/story.json
```

Story Keys have no shared counter, so two branches can both create `WEB-2`. The merge reports a conflict,
and `rowbly doctor` repairs it:

```console
$ git merge dark-mode
CONFLICT (add/add): Merge conflict in .rowbly/boards/web/stories/WEB-2/story.json
Automatic merge failed; fix conflicts and then commit the result.

$ rowbly doctor --fix
Fixed (2)
  STORY_KEY_CONFLICT  boards/web/stories/WEB-2/story.json
    kept WEB-2 ("Theme picker") and renumbered "CSV export" to WEB-3
  DUPLICATE_RANK  boards/web
    re-ranked WEB-3 in Stage "backlog", keeping the current order

No problems found

$ git add .rowbly && git commit --no-edit
```

Run `rowbly doctor` after any merge that touched `.rowbly/`. It also finds conflict markers, files that
are not valid, and Stories in Stages that no longer exist. The [git workflow](docs/user-guide.md#data-root-and-git-workflow)
section of the user guide has the details.

Rowbly's own saves are coordinated too. Every save holds a lock on the Data Root and goes through a commit
journal: two Rowbly processes never lose each other's changes, and if Rowbly is killed partway through a
save, the next Rowbly command finishes or undoes it, so Rowbly never reads half a change.

## The board

`rowbly` opens the Board in a full-screen terminal app. Stages sit side by side: Backlog first, then the
Stages you configure (Todo and In Progress to start), then Done. Each Story shows its Story Key, Priority
and name.

| Key | What it does |
| --- | --- |
| `←` `→` `↑` `↓` or `h` `j` `k` `l` | move between Stages and Stories |
| `shift` + `←` / `→` | move the Story to the previous or next Stage |
| `shift` + `↑` / `↓` | move the Story up or down within its Stage |
| `enter` | open the Story |
| `n` | new Story |
| `/` | filter by Label, Priority or text |
| `v` | switch between the Stages view and a list view |
| `,` | settings: Boards, Stages, Custom Fields, Plugins and Doctor |
| `?` | every key on the current screen |
| `q` | quit |

The mouse works too: click a Story to select it, click again to open it, or drag it onto another Stage.
Descriptions are Markdown, with a full-screen editor that shows them rendered.

## On the command line

Everything you do on the board has a command:

```console
$ rowbly stories create --name "Sign-up form" --priority P2
Created WEB-4: Sign-up form

$ rowbly stories move WEB-4 todo
Moved WEB-4 to todo

$ rowbly stories list --open --sort priority
KEY    NAME            STAGE          PRIORITY  LABELS  DUE
WEB-1  Password reset  ● In Progress  P1        auth
WEB-4  Sign-up form    ● Todo         P2
WEB-2  Theme picker    ● Backlog
WEB-3  CSV export      ● Backlog
```

Add `--json` to any list or show command for output a program can read. Errors arrive on stderr in one
shape, `{"error":{"code","message","details"}}`, with a [documented exit code](docs/user-guide.md#exit-codes).
`--no-prompt` makes a command fail instead of asking for a missing value.

### For coding agents

The npm package includes five skills for coding agents that run Rowbly from a shell:

| Skill | Covers |
| --- | --- |
| [`rowbly-cli`](skills/rowbly-cli/SKILL.md) | The shared rules: `--json`, `--no-prompt`, exit codes and JSON errors |
| [`rowbly-setup`](skills/rowbly-setup/SKILL.md) | `init`, Boards, Me, Stages and Custom Fields |
| [`rowbly-stories`](skills/rowbly-stories/SKILL.md) | Finding, creating, moving and finishing Stories and Tasks |
| [`rowbly-plugins`](skills/rowbly-plugins/SKILL.md) | Turning Plugins on and using their commands |
| [`rowbly-doctor`](skills/rowbly-doctor/SKILL.md) | Checking and repairing a Data Root after a merge |

After `npm install -g rowbly` they are in `$(npm root -g)/rowbly/skills`. For Claude Code, copy them into
your skills folder:

```sh
mkdir -p ~/.claude/skills
cp -r "$(npm root -g)"/rowbly/skills/rowbly-* ~/.claude/skills/
```

For another agent, copy the same folders wherever it loads skills from.

## Plugins

The core of Rowbly is Boards, Stories, Stages, Custom Fields and Me. Everything else is a Built-in
Plugin. Each one is off until a Data Root turns it on, for everyone who uses that Data Root:

```sh
rowbly plugins enable tasks
```

| Plugin | Adds |
| --- | --- |
| [Tasks](docs/plugins/built-in.md#tasks) | Tasks inside a Story (`WEB-42.1`), each with its own Stage |
| [Comments](docs/plugins/built-in.md#comments) | Comment Threads on Stories |
| [Assignees](docs/plugins/built-in.md#assignees) | A roster of Assignees, and the Assignees of each Story |
| [Epics](docs/plugins/built-in.md#epics) | Groups of Stories across Boards, with Epic Progress |
| [Specs](docs/plugins/built-in.md#specs) | Markdown Spec documents for Boards and Stories |
| [Git](docs/plugins/built-in.md#git) | Automatic Commits of saved Rowbly changes |

Turning a Plugin on only enables code that ships with Rowbly. A cloned `.rowbly/` folder cannot make
Rowbly run code from anywhere else.

## Documentation

| You want to… | Read |
| --- | --- |
| Look up a command, flag, key or exit code | [User guide](docs/user-guide.md) |
| Set Stages and Custom Fields for one Board or all of them | [Configuration Cascade](docs/user-guide.md#configuration-cascade) |
| Fix what a merge left behind | [Doctor](docs/user-guide.md#doctor) |
| Learn the words Rowbly uses | [Glossary](docs/agents/CONTEXT.md) |
| See what is in `.rowbly/` | [Data model](docs/architecture/data-model.md) |
| Know how a save survives a crash | [Storage and commits](docs/architecture/storage.md) |
| Add a Plugin to Rowbly | [Writing a Plugin](docs/plugins/writing-a-plugin.md) and the [Plugin API](docs/plugins/api.md) |
| Know why Rowbly works the way it does | [Architecture decisions](docs/agents/adr/README.md) |

## Development

```sh
git clone https://github.com/sgolovine/rowbly.git
cd rowbly
pnpm install
pnpm dev     # the TUI, run from source, on this repository's own Board
pnpm test
```

The [development guide](docs/development/README.md) covers the checks, tests and tracing, and
[`AGENTS.md`](AGENTS.md) has the rules for anyone, person or agent, changing the code.

## License

[MIT](LICENSE.md)
