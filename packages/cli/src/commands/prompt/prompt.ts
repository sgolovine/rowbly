import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { text } from "node:stream/consumers";
import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import {
  getPrompt,
  listPrompts,
  PROMPT_AUDIENCE,
  PROMPT_NAMES,
  setPrompt,
  type UserPrompt,
} from "../../services/prompts/prompts.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { run } from "../output/output.js";

interface SetOptions {
  text?: string;
  file?: string;
}

const NAMES = PROMPT_NAMES.join(", ");

function promptState(prompt: UserPrompt): string {
  if (!prompt.exists) {
    return "missing";
  }

  return prompt.text ? `${prompt.text.split("\n").length} lines` : "empty";
}

function listText(prompts: readonly UserPrompt[]): string {
  return prompts
    .map((prompt) => `${prompt.name.padEnd(12)} ${promptState(prompt).padEnd(10)} ${PROMPT_AUDIENCE[prompt.name]}`)
    .join("\n");
}

/** The text from `--text` or `--file` (`-` reads stdin), relative to the directory of `-C`. */
async function readText(opts: SetOptions, ctx: ServiceContext): Promise<string> {
  if ((opts.text === undefined) === (opts.file === undefined)) {
    throw new ValidationError("Use --text or --file");
  }

  if (opts.file === undefined) {
    return opts.text ?? "";
  }

  if (opts.file === "-") {
    return text(process.stdin);
  }

  return readFile(resolve(ctx.cwd ?? process.cwd(), opts.file), "utf8");
}

function registerList(program: Command): void {
  program
    .command("list")
    .description("List the user prompts of the project, in .rowbly/prompts/")
    .action((_opts: unknown, command: Command) => run(command, (ctx) => listPrompts(ctx), listText));
}

function registerGet(program: Command): void {
  program
    .command("get <name>")
    .description(`Show a user prompt (${NAMES})`)
    .action((name: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => getPrompt(name, ctx),
        (prompt) => prompt.text || "(no prompt)",
      ),
    );
}

function registerSet(program: Command): void {
  program
    .command("set <name>")
    .description(`Replace a user prompt (${NAMES})`)
    .option("--text <markdown>", "the new text; an empty value clears the prompt")
    .option("--file <path>", "read the new text from a file; - reads stdin")
    .action((name: string, opts: SetOptions, command: Command) =>
      run(
        command,
        async (ctx) => setPrompt({ name, text: await readText(opts, ctx) }, ctx),
        (prompt) => `Updated the ${prompt.label} prompt`,
      ),
    );
}

/** Registers the `rowbly prompt` subcommands on the `prompt` command. */
export function registerPromptCommands(program: Command): void {
  registerList(program);
  registerGet(program);
  registerSet(program);
}
