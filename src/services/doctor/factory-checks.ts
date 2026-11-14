import { readFile, rm } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { type ProjectConfig, readConfig, writeConfig } from "../config/config.js";
import { validFactorySettings } from "../factory-settings/factory-settings.js";
import { pathExists } from "../files/files.js";
import { type DoctorIssue, type DoctorRun, noted, rel, report, withoutKey } from "./doctor-run.js";

const LEGACY_MESSAGE =
  "factory.json is no longer read. The factory settings are in the factory key of rowbly.config.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Gives the parsed JSON of the old file, or undefined when it is not a JSON object. */
function parseLegacy(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);

    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The `factory` section must be valid. The factory does not start without valid settings, but the board works. */
function sectionIssues(run: DoctorRun, config: ProjectConfig): DoctorIssue[] {
  if (config.factory === undefined || validFactorySettings(config.factory)) {
    return [];
  }

  return [
    noted({
      severity: "error",
      message: "factory: Invalid factory settings. Fix the factory section by hand",
      file: rel(run, run.paths.configFile),
    }),
  ];
}

/** Writes the settings of the old file to the config, then deletes the file. It reads the config again first. */
async function moveSettings(run: DoctorRun, settings: Record<string, unknown>): Promise<void> {
  const config = await readConfig(run.paths);

  await writeConfig(run.paths, { ...config, factory: settings });
  await rm(run.paths.legacyFactorySettingsFile);
}

/** Compares the old file with the `factory` section, and moves or deletes the file when that is safe. */
async function legacyIssue(run: DoctorRun, config: ProjectConfig, settings: Record<string, unknown>) {
  const file = rel(run, run.paths.legacyFactorySettingsFile);

  if (config.factory === undefined) {
    return report(
      run,
      { severity: "warning", message: LEGACY_MESSAGE, file, fix: "Move it to rowbly.config.json" },
      () => moveSettings(run, settings),
    );
  }

  if (isDeepStrictEqual(config.factory, settings)) {
    return report(run, { severity: "warning", message: LEGACY_MESSAGE, file, fix: "Delete it" }, () =>
      rm(run.paths.legacyFactorySettingsFile),
    );
  }

  return noted({
    severity: "warning",
    message: `${LEGACY_MESSAGE}, and that key has different settings. Merge them by hand, then delete factory.json`,
    file,
  });
}

/** Checks an old `factory.json`. A file that is not valid stays, because it can hold the only copy of the settings. */
async function legacyIssues(run: DoctorRun, config: ProjectConfig): Promise<DoctorIssue[]> {
  const legacy = run.paths.legacyFactorySettingsFile;

  if (!(await pathExists(legacy))) {
    return [];
  }

  const parsed = parseLegacy(await readFile(legacy, "utf8"));
  const file = rel(run, legacy);

  if (parsed === undefined) {
    return [noted({ severity: "error", message: `${LEGACY_MESSAGE}. It is not a valid JSON object`, file })];
  }

  const settings = withoutKey(parsed, "version");

  if (!validFactorySettings(settings)) {
    return [noted({ severity: "error", message: `${LEGACY_MESSAGE}. It has invalid factory settings`, file })];
  }

  return [await legacyIssue(run, config, settings)];
}

/**
 * Checks the `factory` section of the config and an old `factory.json`. Run it after the stage checks: a stage fix
 * writes the config, so this check reads the config again from disk.
 */
export async function checkFactory(run: DoctorRun): Promise<DoctorIssue[]> {
  const config = await readConfig(run.paths);

  return [...sectionIssues(run, config), ...(await legacyIssues(run, config))];
}
