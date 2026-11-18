import { readFile } from "node:fs/promises";
import { text as streamText } from "node:stream/consumers";
import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import {
  applyOnboarding,
  type OnboardingInput,
  type OnboardingResult,
  parseOnboardingInput,
} from "../../services/onboarding/onboarding.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { askOnboarding } from "../init-wizard/init-wizard.js";
import { collect, run } from "../output/output.js";

interface InitOptions {
  name?: string;
  key?: string;
  stage?: string[];
  skill?: string[];
  /** `false` with `--no-skills`. */
  skills: boolean;
  harness?: string[];
  input?: string;
  defaults?: boolean;
}

/** The text of `--input`: `-` is stdin, text that starts with `{` is the JSON itself, and all else is a file path. */
async function inputText(source: string): Promise<string> {
  if (source === "-") {
    return streamText(process.stdin);
  }

  if (source.trimStart().startsWith("{")) {
    return source;
  }

  return readFile(source, "utf8").catch(() => {
    throw new ValidationError(`Rowbly cannot read the file ${source}`);
  });
}

/** Reads and checks `--input`. */
async function readInput(source: string): Promise<OnboardingInput> {
  const text = await inputText(source);

  try {
    return parseOnboardingInput(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ValidationError(`The setup input is not valid JSON: ${error.message}`);
    }

    throw error;
  }
}

/** The choices that the flags give. A flag takes priority over the same key in `--input`. */
function flagInput(opts: InitOptions): OnboardingInput {
  const skills = opts.skills === false ? [] : opts.skill;

  return {
    ...(opts.name === undefined ? {} : { name: opts.name }),
    ...(opts.key === undefined ? {} : { key: opts.key }),
    ...(opts.stage === undefined ? {} : { stages: opts.stage }),
    ...(skills === undefined ? {} : { skills }),
    ...(opts.harness === undefined ? {} : { harnesses: opts.harness }),
  };
}

function describe(result: OnboardingResult): string {
  const width = Math.max(...result.edits.map((edit) => edit.what.length)) + 2;
  const skills = result.skills ?? [];

  return [
    `Created ${result.projectName} (${result.projectKey}) in ${result.root}`,
    `Stages: ${result.stages.map((stage) => stage.key).join(", ")}`,
    ...(skills.length > 0
      ? [
          `Skills: ${skills.map((skill) => skill.name).join(", ")}`,
          `Harnesses: ${[...new Set(skills.flatMap((skill) => skill.harnesses))].join(", ")}`,
        ]
      : []),
    ...result.warnings.map((warning) => `Warning: ${warning}`),
    "",
    "Where to edit this later:",
    ...result.edits.map((edit) => `  ${edit.what.padEnd(width)}${edit.where}`),
  ].join("\n");
}

/** Questions run only in a terminal, with no choice flags, no `--input`, no `--defaults` and no `--json`. */
function isInteractive(opts: InitOptions, flags: OnboardingInput, json: boolean | undefined): boolean {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      !json &&
      !opts.defaults &&
      opts.input === undefined &&
      Object.keys(flags).length === 0,
  );
}

/** Creates the project from the answers, or from `--input` and the flags. A cancel gives `null`. */
async function initProject(
  opts: InitOptions,
  flags: OnboardingInput,
  interactive: boolean,
  ctx: ServiceContext,
): Promise<OnboardingResult | null> {
  const input = interactive
    ? await askOnboarding(ctx)
    : { ...(opts.input === undefined ? {} : await readInput(opts.input)), ...flags };

  return input && applyOnboarding(input, ctx);
}

/** Runs `rowbly init`. */
function initAction(opts: InitOptions, command: Command): Promise<void> {
  const flags = flagInput(opts);
  const { json } = command.optsWithGlobals<{ json?: boolean }>();
  const interactive = isInteractive(opts, flags, json);

  return run(
    command,
    (ctx) => initProject(opts, flags, interactive, ctx),
    (result) => (result ? describe(result) : ""),
  );
}

/** Registers `rowbly init`. */
export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Set up a Rowbly project in the current directory")
    .option("--name <name>", "project name (default: the directory's name)")
    .option("--key <key>", "story ID prefix, e.g. ROW (default: the first 3 letters of the name)")
    .option(
      "--stage <stage>",
      "a default stage, or the name of a custom stage, in board order; Backlog and Done are always added (repeat)",
      collect,
    )
    .option("--skill <name>", "a bundled skill to install (repeat; default: all)", collect)
    .option("--no-skills", "install no skills")
    .option("--harness <id>", "a harness for the skills (repeat; default: all)", collect)
    .option("--input <json|file|->", "the choices as JSON: inline, in a file, or - for stdin")
    .option("--defaults", "use the default of each step, with no questions")
    .action((opts: InitOptions, command: Command) => initAction(opts, command));
}
