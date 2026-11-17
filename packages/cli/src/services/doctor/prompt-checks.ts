import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathExists, writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { OLD_SUPERVISOR_FILE, PROMPT_NAMES, type PromptName, readUserPrompt } from "../prompts/prompts.js";
import { type DoctorIssue, type DoctorRun, noted, rel, report } from "./doctor-run.js";

/** The text that `rowbly init` wrote to `ROWBLY.md` before the user prompts. A file with only this text has no prompt. */
const LEGACY_DEFAULT = "# ROWBLY INSTRUCTIONS";

/** Moves the text of `ROWBLY.md` to the Project prompt, or deletes a file that has only the default text. */
async function legacyIssues(run: DoctorRun): Promise<DoctorIssue[]> {
  const legacy = run.paths.legacyInstructionsFile;

  if (!(await pathExists(legacy))) {
    return [];
  }

  const text = (await readFile(legacy, "utf8")).trim();
  const file = rel(run, legacy);
  const target = await readUserPrompt(run.paths, "system");
  const message = "ROWBLY.md is no longer read. The Project prompt is prompts/SYSTEM.md";

  if (text === "" || text === LEGACY_DEFAULT) {
    return [await report(run, { severity: "warning", message, file, fix: "Delete it" }, () => rm(legacy))];
  }

  if (target.text) {
    return [noted({ severity: "warning", message: `${message}, and that file has text. Merge them by hand`, file })];
  }

  return [
    await report(run, { severity: "warning", message, file, fix: "Move it to prompts/SYSTEM.md" }, async () => {
      await mkdir(run.paths.promptsDir, { recursive: true });
      await rename(legacy, target.path);
    }),
  ];
}

async function missingIssue(run: DoctorRun, name: PromptName): Promise<DoctorIssue[]> {
  const prompt = await readUserPrompt(run.paths, name);

  if (prompt.exists) {
    return [];
  }

  return [
    await report(
      run,
      {
        severity: "warning",
        message: `The ${prompt.label} prompt is missing`,
        file: rel(run, prompt.path),
        fix: "Create an empty one",
      },
      async () => {
        await mkdir(run.paths.promptsDir, { recursive: true });
        await writeFileAtomic(prompt.path, "");
      },
    ),
  ];
}

/**
 * An old `.rowbly/prompts/SUPERVISOR.md` is a warning, because Rowbly does not use it. The warning has no fix:
 * Rowbly never deletes this user file, and a missing file is not a problem.
 */
async function oldSupervisorIssues(run: DoctorRun): Promise<DoctorIssue[]> {
  const path = join(run.paths.promptsDir, OLD_SUPERVISOR_FILE);

  if (!(await pathExists(path))) {
    return [];
  }

  return [
    noted({
      severity: "warning",
      message: "Rowbly does not use the Supervisor prompt. You can delete this file",
      file: rel(run, path),
    }),
  ];
}

/**
 * Each user prompt in `.rowbly/prompts/` must exist. The factory works without them, so a missing prompt is a
 * warning. An old `ROWBLY.md` is also a warning, because the factory does not read it.
 */
export async function checkPrompts(run: DoctorRun): Promise<DoctorIssue[]> {
  const legacy = await legacyIssues(run);
  const missing = await mapInOrder(PROMPT_NAMES, (name) => missingIssue(run, name));
  const oldSupervisor = await oldSupervisorIssues(run);

  return [...legacy, ...missing.flat(), ...oldSupervisor];
}
