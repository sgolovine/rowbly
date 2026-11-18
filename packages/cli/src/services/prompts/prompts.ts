import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { packageDir, writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { refuseRemoteWrite } from "../outbox/outbox.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

/**
 * The prompt layers. Each name has a system prompt in `src/config/prompts/` of the Rowbly package, and a
 * user prompt in `.rowbly/prompts/` of the project. The Stage prompts in `.rowbly/stages/` are a separate layer.
 */
export const PROMPT_NAMES = ["system", "worker"] as const;

export type PromptName = (typeof PROMPT_NAMES)[number];

/** The file name of each prompt, in `src/config/prompts/` and in `.rowbly/prompts/`. */
const PROMPT_FILES: Record<PromptName, string> = {
  system: "SYSTEM.md",
  worker: "WORKER.md",
};

/** The name of each user prompt in the UI and in a message. */
const PROMPT_LABELS: Record<PromptName, string> = {
  system: "Project",
  worker: "Worker",
};

/** The agents that get each prompt. */
export const PROMPT_AUDIENCE: Record<PromptName, string> = {
  system: "All workers. The Worker prompt has priority over it.",
  worker: "All workers, in all Stages.",
};

/** A user prompt of the project. */
export interface UserPrompt {
  readonly name: PromptName;
  readonly label: string;
  /** The absolute path of the file, also when the file does not exist. */
  readonly path: string;
  /** False when the file does not exist. A missing prompt has no text. */
  readonly exists: boolean;
  readonly text: string;
}

function isPromptName(value: string): value is PromptName {
  return (PROMPT_NAMES as readonly string[]).includes(value);
}

/** The path of a user prompt in `.rowbly/prompts/`. */
export function userPromptPath(paths: ProjectPaths, name: PromptName): string {
  return join(paths.promptsDir, PROMPT_FILES[name]);
}

/** The path of a system prompt in the Rowbly package. */
export async function systemPromptPath(name: PromptName): Promise<string> {
  return join(await packageDir(), "src", "config", "prompts", PROMPT_FILES[name]);
}

/** Reads a system prompt. The Rowbly package always has the two files. */
export async function readSystemPrompt(name: PromptName): Promise<string> {
  return (await readFile(await systemPromptPath(name), "utf8")).trim();
}

/** Reads the file, or gives `undefined` when it does not exist. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/** Reads a user prompt. A project can omit each prompt; a missing file gives a prompt with no text. */
export async function readUserPrompt(paths: ProjectPaths, name: PromptName): Promise<UserPrompt> {
  const path = userPromptPath(paths, name);
  const text = await readOptional(path);

  return { name, label: PROMPT_LABELS[name], path, exists: text !== undefined, text: text?.trim() ?? "" };
}

/** Creates the `.rowbly/prompts/` folder and an empty file for each user prompt that does not exist. */
export async function createUserPrompts(paths: ProjectPaths): Promise<void> {
  await mkdir(paths.promptsDir, { recursive: true });
  await mapInOrder(PROMPT_NAMES, async (name) => {
    const prompt = await readUserPrompt(paths, name);

    if (!prompt.exists) {
      await writeFileAtomic(prompt.path, "");
    }
  });
}

/** The name of the old Supervisor prompt. Rowbly does not use it, and its file in `.rowbly/prompts/` stays. */
const OLD_SUPERVISOR = "supervisor";

/** The file name of the old Supervisor prompt in `.rowbly/prompts/`. Rowbly does not read or delete it. */
export const OLD_SUPERVISOR_FILE = "SUPERVISOR.md";

function checkName(name: string): PromptName {
  if (name === OLD_SUPERVISOR) {
    throw new ValidationError("Rowbly no longer uses a Supervisor prompt", {
      hint: `The factory starts the workers itself. Use one of: ${PROMPT_NAMES.join(", ")}.`,
    });
  }

  if (!isPromptName(name)) {
    throw new NotFoundError(`No prompt named "${name}"`, { hint: `Use one of: ${PROMPT_NAMES.join(", ")}.` });
  }

  return name;
}

/** Gives the two user prompts of the project. */
export async function listPrompts(ctx: ServiceContext = {}): Promise<UserPrompt[]> {
  const paths = await findProject(ctx);

  return mapInOrder(PROMPT_NAMES, (name) => readUserPrompt(paths, name));
}

/** Gives one user prompt of the project. */
export async function getPrompt(name: string, ctx: ServiceContext = {}): Promise<UserPrompt> {
  return readUserPrompt(await findProject(ctx), checkName(name));
}

export interface SetPromptInput {
  readonly name: string;
  readonly text: string;
}

/** Replaces the text of a user prompt. It creates the file and the folder when they do not exist. */
export async function setPrompt(input: SetPromptInput, ctx: ServiceContext = {}): Promise<UserPrompt> {
  refuseRemoteWrite(ctx, "change a user prompt");

  const name = checkName(input.name);

  if (typeof input.text !== "string") {
    throw new ValidationError("The prompt text must be a string");
  }

  const paths = await findProject(ctx);
  const text = input.text.trim();

  await mkdir(paths.promptsDir, { recursive: true });
  await writeFileAtomic(userPromptPath(paths, name), text ? `${text}\n` : "");

  return readUserPrompt(paths, name);
}
