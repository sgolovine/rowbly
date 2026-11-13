import type { Dispatch, RefObject, SetStateAction } from "react";
import type { SkillHarness } from "../../../../services/config/config.js";
import { ValidationError } from "../../../../services/errors/errors.js";
import {
  type InstallSkillResult,
  installSkill,
  type RemoveSkillResult,
  removeSkill,
  type SkillStatus,
} from "../../../../services/skill/skill.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { runExclusive, showToast, type ToastStore } from "../../../hooks/index.js";

/** Install copies a skill to harnesses. Remove deletes the tracked copies. */
export type SkillMode = "install" | "remove";

/** What an install or a removal reads and changes. */
export interface SkillActionEnv {
  readonly ctx: ServiceContext;
  readonly mode: SkillMode;
  readonly name: string;
  readonly harnesses: readonly SkillHarness[];
  readonly toast: ToastStore;
  /** True while an install or a removal runs, so that a second submit does not run one more. */
  readonly pending: RefObject<boolean>;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly setTargets: Dispatch<SetStateAction<string[] | null>>;
  readonly onSaved: () => void;
}

type HarnessResult = (InstallSkillResult | RemoveSkillResult)["harnesses"][number];

/** The words of the result of one harness. */
function harnessStatusText(status: HarnessResult["status"]): string {
  if (status === "shared") {
    return "shared (folder kept)";
  }

  return status === "missing" ? "already missing" : status;
}

/** The result of each harness, in one line for a toast. */
export function skillResultText(name: string, result: InstallSkillResult | RemoveSkillResult): string {
  return `${name}: ${result.harnesses.map((h) => `${h.harness}: ${harnessStatusText(h.status)}`).join("; ")}`;
}

/** The paths that a removal deletes, so that the person can check them before the confirmation. */
export function removalMessage(name: string, targets: readonly string[], tracked: SkillStatus | undefined): string {
  const paths = targets.map((h) => `${h}: ${tracked?.harnesses.find((entry) => entry.harness === h)?.path}`);

  return `Uninstall ${name} for these harnesses?\n${paths.join("\n")}\nRemoval deletes local changes in removed folders. Another harness can still read a retained or shared skill folder.`;
}

/** Installs or removes the skill for the selected harnesses, unless a run has not finished. */
async function runSkillAction(env: SkillActionEnv, selected: string[]): Promise<void> {
  await runExclusive(env.pending, () => applySkillAction(env, selected));
}

async function applySkillAction(env: SkillActionEnv, selected: string[]): Promise<void> {
  env.setBusy(true);

  try {
    const input = { name: env.name, harnesses: selected };
    const result = env.mode === "install" ? await installSkill(input, env.ctx) : await removeSkill(input, env.ctx);

    showToast(env.toast, "info", skillResultText(env.name, result));
    env.onSaved();
  } finally {
    env.setBusy(false);
  }
}

/** An install runs at once. A removal first shows the paths that it deletes. */
export async function submitSkillForm(env: SkillActionEnv, values: FormValues): Promise<void> {
  const selected = env.harnesses.filter((h) => values[h] === true);

  if (selected.length === 0) {
    throw new ValidationError("Select at least one harness.");
  }

  if (env.mode === "remove") {
    env.setTargets(selected);

    return;
  }

  await runSkillAction(env, selected);
}

/** Runs the confirmed removal. An error closes the confirmation and shows a toast. */
export function confirmRemoval(env: SkillActionEnv, targets: string[]): void {
  runSkillAction(env, targets).catch((error: unknown) => removalFailed(env, error));
}

function removalFailed(env: SkillActionEnv, error: unknown): void {
  env.toast.error(error);
  env.setTargets(null);
}
