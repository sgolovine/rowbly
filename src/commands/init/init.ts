import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { ValidationError } from "../../services/errors/errors.js";
import {
  applyOnboarding,
  type OnboardingInput,
  type OnboardingResult,
  parseOnboardingInput,
} from "../../services/onboarding/onboarding.js";
import { askOnboarding } from "../initWizard/initWizard.js";
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

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** Reads `--input`: `-` is stdin, text that starts with `{` is the JSON itself, and all else is a file path. */
async function readInput(source: string): Promise<OnboardingInput> {
  let text = source;
  if (source === "-") text = await readStdin();
  else if (!source.trimStart().startsWith("{")) {
    text = await readFile(source, "utf8").catch(() => {
      throw new ValidationError(`Rowbly cannot read the file ${source}`);
    });
  }
  try {
    return parseOnboardingInput(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ValidationError(`The setup input is not valid JSON: ${error.message}`);
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
    "",
    "Where to edit this later:",
    ...result.edits.map((edit) => `  ${edit.what.padEnd(width)}${edit.where}`),
  ].join("\n");
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Set up a Rowbly project in the current directory")
    .option("--name <name>", "project name (default: the directory's name)")
    .option("--key <key>", "story ID prefix, e.g. ROW (default: the first 3 letters of the name)")
    .option("--stage <stage>", "a default stage, or the name of a custom stage, in board order (repeat)", collect)
    .option("--skill <name>", "a bundled skill to install (repeat; default: all)", collect)
    .option("--no-skills", "install no skills")
    .option("--harness <id>", "a harness for the skills (repeat; default: all)", collect)
    .option("--input <json|file|->", "the choices as JSON: inline, in a file, or - for stdin")
    .option("--defaults", "use the default of each step, with no questions")
    .action((opts: InitOptions, command: Command) => {
      const flags = flagInput(opts);
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      const interactive =
        process.stdin.isTTY &&
        process.stdout.isTTY &&
        !json &&
        !opts.defaults &&
        opts.input === undefined &&
        Object.keys(flags).length === 0;
      return run(
        command,
        async (ctx) => {
          const input = interactive
            ? await askOnboarding(ctx)
            : { ...(opts.input === undefined ? {} : await readInput(opts.input)), ...flags };
          return input && applyOnboarding(input, ctx);
        },
        (result) => (result ? describe(result) : ""),
      );
    });
}
