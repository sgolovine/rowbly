<p align="center">
  <img src="https://raw.githubusercontent.com/sgolovine/rowbly/main/assets/header.png" alt="rowbly: a file-backed Kanban board for you and your agent, right in your terminal" width="100%">
</p>

<p align="center">
  <a href="https://github.com/sgolovine/rowbly/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sgolovine/rowbly/ci.yml?branch=main&label=build" alt="Build status"></a>
  <a href="https://www.npmjs.com/package/rowbly"><img src="https://img.shields.io/npm/v/rowbly?color=f5b841" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/rowbly"><img src="https://img.shields.io/npm/dm/rowbly?color=blue" alt="npm downloads"></a>
  <a href="https://github.com/sgolovine/rowbly/blob/main/LICENSE.md"><img src="https://img.shields.io/npm/l/rowbly" alt="License"></a>
</p>

<p align="center">
  <strong>The Easiest Way to Run an AI Software Factory</strong>
</p>

Rowbly is the simplest way to set up and manage an AI-powered software factory. Create stories, organize them into predefined stages, and let your AI agents automatically pick up and execute the work.

The biggest challenge with AI software factories isn't writing code, it's orchestrating the agents. Coordinating supervisors, delegating tasks, and tracking progress can quickly become a project of its own.

Rowbly eliminates that complexity with an intuitive Kanban board and a companion agent skill that runs a supervisor to monitor your workflow, assign work to agents, and keep development moving automatically.

<p align="center">
  <img src="https://raw.githubusercontent.com/sgolovine/rowbly/main/assets/screenshot.png" alt="The Rowbly terminal UI shows the stories of a project, grouped by stage, with the name of the agent that works on each story" width="100%">
</p>

## Agent Installation

Paste this prompt into your agent harness (Claude Code, Codex, Gemini CLI, GitHub Copilot or Cursor). Run the agent in the root of your repository.

```text
Install and set up Rowbly (https://github.com/sgolovine/rowbly) in this repository. Do these steps:

1. Run `node --version`. Rowbly needs Node 24 or later. If the version is older, stop and tell me.
2. Run `npm install -g rowbly`. If the global install fails because of permissions, use `npx rowbly` in place of `rowbly` for the steps that follow.
3. Run `rowbly --version` to confirm the install.
4. If `.rowbly/` already exists in this directory, skip to step 6.
5. Run `rowbly init --defaults --harness <id>`, where `<id>` is the harness that you are: `claude-code`, `codex`, `gemini-cli`, `github-copilot` or `cursor`. Do not run `rowbly` with no arguments, because that starts the interactive TUI.
6. Run `rowbly doctor`. If it reports problems, run `rowbly doctor --fix` and then run `rowbly doctor` again.
7. Run `rowbly project get-instructions` and `rowbly --help`, and read the installed Rowbly skills, so that you know how to use Rowbly.
8. Tell me what you installed: the project name and key, the stages, the skills and the folders that they are in. Then tell me to run `rowbly` to open the board.
```

## Manual Installation

Rowbly runs on Node 24 or later. Install it from npm:

```sh
npm install -g rowbly
```

You can also run it directly with `npx`:

```sh
npx rowbly
```

Once started, initialize rowbly in one of two ways:

```sh

rowbly # runs interactive TUI onboarding

rowbly init # same process as above but without the TUI
```

Press `?` in the terminal UI to see all the keys. Run `rowbly --help` to see all the commands.

## Features

- **Board in plain files.** Each story is a Markdown file in your repository.
- **Prompts for each stage.** Tell your agents what to do with a story in each stage.
- **Custom fields.** Add the data that your project wants on each story.
- **Skills that are ready for use.** Install the factory, refine, develop and review skills in your project.

## Skills

Rowbly comes with four skills that teach your agent a full development process:

| Skill     | What it does                                                                    |
| --------- | ------------------------------------------------------------------------------- |
| `refine`  | Makes a story ready for development. It writes no code.                         |
| `develop` | Builds a refined story in a Git worktree, or fixes the findings of a review.    |
| `review`  | Examines the pull request of a story and reports if the work is ready to merge. |
| `factory` | Watches your stories and starts a worker when a story changes stage.            |

Use one skill by itself, or use all four as a software factory. Put stories on the board, and the factory starts the correct worker for each stage.

Install a skill for one or more harnesses:

```sh
rowbly skill install factory --harness claude-code --harness codex
```

| Harness          | Project skills folder |
| ---------------- | --------------------- |
| `claude-code`    | `.claude/skills`      |
| `codex`          | `.agents/skills`      |
| `gemini-cli`     | `.gemini/skills`      |
| `github-copilot` | `.github/skills`      |
| `cursor`         | `.cursor/skills`      |

Run `rowbly skill list` to see the installed skills. Run `rowbly skill remove` to remove a skill.

Keep your changes to an installed skill in a different place. `rowbly skill remove` deletes the folder and all local changes in it.

## Development

Rowbly uses TypeScript, [Commander.js](https://github.com/tj/commander.js) and [Ink](https://github.com/vadimdemedes/ink). It uses [pnpm](https://pnpm.io) as the package manager.

```sh
git clone https://github.com/sgolovine/rowbly.git
cd rowbly
pnpm install
pnpm dev              # run the terminal UI from source
pnpm dev --help       # run the CLI from source
pnpm add -g "path:$PWD" # install rowbly to your PATH
```

Run these checks before you send a change:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Read [`AGENTS.md`](https://github.com/sgolovine/rowbly/blob/main/AGENTS.md) for the architecture, the conventions and the rules for the TUI design system.

## License

Rowbly is free software under the [MIT License](https://github.com/sgolovine/rowbly/blob/main/LICENSE.md).
