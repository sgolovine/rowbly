import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import { ConflictError } from "../errors/errors.js";
import { projectWriteLockPath } from "../projectWrite/projectWrite.js";
import { bundledSkills } from "../skill/skill.js";
import type { WorkerResult } from "../thread/thread.js";

export function createResultTool(record: (result: WorkerResult) => Promise<void>) {
  let previous: string | undefined;
  return {
    name: "report_result",
    label: "Report result",
    description: "Record the final bounded result. Stop after this tool.",
    parameters: Type.Object({
      outcome: Type.String({ maxLength: 100 }),
      summary: Type.String({ maxLength: 1000 }),
      branch: Type.Optional(Type.String({ maxLength: 500 })),
      commits: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 20 })),
      pullRequest: Type.Optional(Type.String({ maxLength: 1000 })),
      blockers: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }),
      problems: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 }),
    }),
    async execute(_id: string, result: WorkerResult) {
      const text = JSON.stringify(result);
      if (previous && previous !== text) throw new ConflictError("Result already recorded with different values");
      if (!previous) await record(result);
      previous = text;
      return { content: [{ type: "text" as const, text: "Recorded. Stop now." }], details: {} };
    },
  };
}
export async function workerMessage(input: {
  root: string;
  story: string;
  stage: string;
  prompt: string;
  shim: string;
  worktree: string;
  model: string;
  skillsDir: string;
}) {
  const instructions = await readFile(join(input.root, ".rowbly/ROWBLY.md"), "utf8").catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return "";
      throw e;
    },
  );
  const skill = ({ IN_REFINEMENT: "refine", IN_DEVELOPMENT: "develop", IN_REVIEW: "review" } as Record<string, string>)[
    input.stage
  ];
  let skillPath = "Use the Stage prompt.";
  if (skill) {
    for (const base of [join(input.root, ".agents/skills"), join(input.root, ".claude/skills"), input.skillsDir]) {
      const candidate = join(base, skill, "SKILL.md");
      if (
        await access(candidate).then(
          () => true,
          () => false,
        )
      ) {
        skillPath = candidate;
        break;
      }
    }
  }
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const template = await readFile(
    join((await bundledSkills()).dir, "factory/references/worker-message-native.md"),
    "utf8",
  );
  const fields: Record<string, string> = {
    ...input,
    instructions,
    skill: skillPath,
    rootQuoted: quote(input.root),
    shimQuoted: quote(input.shim),
    lockQuoted: quote(await projectWriteLockPath(input.root)),
    lock: await projectWriteLockPath(input.root),
  };
  const { renderWorkerMessage } = (await import(
    pathToFileURL(join((await bundledSkills()).dir, "factory/scripts/worker-message.mjs")).href
  )) as typeof import("../../../skills/factory/scripts/worker-message.mjs");
  return renderWorkerMessage(template, fields);
}
