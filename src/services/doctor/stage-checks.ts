import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { labelFromKey, type ProjectConfig, STAGE_KEY_PATTERN, writeConfig } from "../config/config.js";
import { listMarkdownFiles } from "../files/files.js";
import { type DoctorIssue, type DoctorRun, noted, rel, report } from "./doctor-run.js";
import { mapInOrder } from "./map-in-order.js";

/** The issues, and the config that the later checks use. A fix can add stages to it. */
interface StageCheck {
  readonly issues: DoctorIssue[];
  readonly config: ProjectConfig;
}

async function stageFileIssue(
  run: DoctorRun,
  files: readonly string[],
  stage: ProjectConfig["stages"][number],
): Promise<DoctorIssue[]> {
  const file = join(run.paths.stagesDir, `${stage.key}.md`);

  if (files.includes(`${stage.key}.md`)) {
    return [];
  }

  return [
    await report(
      run,
      {
        severity: "error",
        message: `Stage ${stage.key} has no file`,
        file: rel(run, file),
        fix: "Create an empty one",
      },
      () => writeFile(file, ""),
    ),
  ];
}

function isConfigStage(config: ProjectConfig, name: string): boolean {
  return config.stages.some((stage) => stage.key === name.slice(0, -3));
}

/** The fix only marks the issue. The config write after all files adds the stages together. */
async function extraFileIssue(run: DoctorRun, name: string): Promise<DoctorIssue> {
  const key = name.slice(0, -3);
  const file = rel(run, join(run.paths.stagesDir, name));

  if (!STAGE_KEY_PATTERN.test(key)) {
    return noted({ severity: "error", message: `"${key}" is not a valid stage key (UPPER_SNAKE_CASE)`, file });
  }

  return report(
    run,
    { severity: "error", message: `Stage ${key} is not in the config`, file, fix: "Add it to the config" },
    () => undefined,
  );
}

/** Each stage must have a file, and each stage file must be a stage of the config. */
export async function checkStages(run: DoctorRun, config: ProjectConfig): Promise<StageCheck> {
  const files = await listMarkdownFiles(run.paths.stagesDir);

  const missing = await mapInOrder(config.stages, (stage) => stageFileIssue(run, files, stage));
  const extra = files.filter((name) => !isConfigStage(config, name));
  const extraIssues = await mapInOrder(extra, (name) => extraFileIssue(run, name));
  const added = extra
    .map((name) => name.slice(0, -3))
    .filter((key) => STAGE_KEY_PATTERN.test(key))
    .map((key) => ({ key, label: labelFromKey(key), enabled: true }));

  const issues = [...missing.flat(), ...extraIssues];

  if (!run.fix || added.length === 0) {
    return { issues, config };
  }

  const fixed = { ...config, stages: [...config.stages, ...added] };

  await writeConfig(run.paths, fixed);

  return { issues, config: fixed };
}
