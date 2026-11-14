import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ConflictError } from "../errors/errors.js";
import { Store } from "../store/store.js";
import type { WorkerResult } from "../thread/thread.js";
import { toolParameters } from "../tool-schema/tool-schema.js";

/** The text of the first recorded result. A repeat with the same values is accepted. */
interface ResultState {
  readonly previous: string | undefined;
}

const STAGE_SKILLS: Record<string, string> = {
  IN_REFINEMENT: "refine",
  IN_DEVELOPMENT: "develop",
  IN_REVIEW: "review",
};

async function recordOnce(
  state: Store<ResultState>,
  record: (result: WorkerResult) => Promise<void>,
  result: WorkerResult,
) {
  const text = JSON.stringify(result);
  const { previous } = state.current;

  if (previous && previous !== text) {
    throw new ConflictError("Result already recorded with different values");
  }

  if (!previous) {
    await record(result);
  }

  state.update(() => ({ previous: text }));

  return { content: [{ type: "text" as const, text: "Recorded. Stop now." }], details: {} };
}

/** Makes the `report_result` tool. A worker records one result; a repeat with other values fails. */
export function createResultTool(record: (result: WorkerResult) => Promise<void>) {
  const state = new Store<ResultState>({ previous: undefined });

  return {
    name: "report_result",
    label: "Report result",
    description: "Record the final bounded result. Stop after this tool.",
    parameters: toolParameters(
      z.object({
        outcome: z.string().max(100),
        summary: z.string().max(1000),
        branch: z.string().max(500).optional(),
        commits: z.array(z.string().max(100)).max(20).optional(),
        pullRequest: z.string().max(1000).optional(),
        blockers: z.array(z.string().max(500)).max(10),
        problems: z.array(z.string().max(500)).max(10),
      }),
    ),
    execute(_id: string, result: WorkerResult) {
      return recordOnce(state, record, result);
    },
  };
}

/** Reads `.rowbly/ROWBLY.md`. A missing file gives an empty string. */
export async function readProjectInstructions(root: string): Promise<string> {
  return readFile(join(root, ".rowbly/ROWBLY.md"), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") {
      return "";
    }

    throw e;
  });
}

/** Finds the `SKILL.md` of a Stage. An installed project copy wins over the bundled copy. */
export async function findStageSkill(root: string, stage: string, skillsDir: string): Promise<string> {
  const skill = STAGE_SKILLS[stage];

  if (!skill) {
    return "Use the Stage prompt.";
  }

  for (const base of [join(root, ".agents/skills"), join(root, ".claude/skills"), skillsDir]) {
    const candidate = join(base, skill, "SKILL.md");

    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      return candidate;
    }
  }

  return "Use the Stage prompt.";
}
