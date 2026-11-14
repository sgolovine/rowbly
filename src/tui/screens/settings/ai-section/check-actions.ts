import type { Key } from "ink";
import {
  addCheck,
  removeCheck,
  setCheckLimits,
  updateCheck,
} from "../../../../services/factory-settings/check-items.js";
import { checkLimits } from "../../../../services/factory-settings/check-settings.js";
import type { CheckItem, CheckSpec } from "../../../../services/factory-settings/factory-settings.js";
import type { FormValues } from "../../../components/index.js";
import { showToast } from "../../../hooks/index.js";
import { moveDelta } from "../../../keymap.js";
import { checkChange, text } from "../check-form.js";
import { type AiEnv, finishTask, handleAiKey } from "./ai-actions.js";

/** Gives a new check from the form. The empty values are not written. */
function newCheck(values: FormValues): CheckItem {
  const entries = Object.entries(checkChange(values)).filter(([, value]) => value !== null);

  return { ...Object.fromEntries(entries), key: text(values.key) ?? "" } as CheckItem;
}

/** Saves the check limits. */
export async function saveCheckLimits(env: AiEnv, values: FormValues): Promise<void> {
  await setCheckLimits(
    { maxChecks: values.maxConcurrent as number, checkMemoryReserve: values.reserveMemoryMb as number },
    env.ctx,
  );
  showToast(env.toast, "info", "Saved the check limits");
  finishTask(env, true);
}

/** Adds a check, or saves the changes of the check that the form edits. */
export async function saveCheck(env: AiEnv, check: CheckSpec | undefined, values: FormValues): Promise<void> {
  const saved = check
    ? await updateCheck(check.key, checkChange(values), env.ctx)
    : await addCheck(newCheck(values), env.ctx);

  showToast(env.toast, "info", `Saved the check: ${saved.key}`);
  finishTask(env, true);
}

/** Removes a check. A failure closes the dialog and shows the error. */
export function removeCheckItem(env: AiEnv, check: CheckSpec): void {
  removeCheck(check.key, env.ctx).then(
    () => checkRemoved(env, check),
    (error: unknown) => removeFailed(env, error),
  );
}

function checkRemoved(env: AiEnv, check: CheckSpec): void {
  showToast(env.toast, "info", `Removed the check: ${check.key}`);
  env.setCheckCursor((cursor) => Math.max(0, cursor - 1));
  finishTask(env, true);
}

function removeFailed(env: AiEnv, error: unknown): void {
  env.toast.error(error);
  env.setTask(null);
}

/** The checks of the settings, in the order of `factory.json`. */
function settingsChecks(env: AiEnv): readonly CheckSpec[] {
  return checkLimits(env.settings.data?.checks)?.items ?? [];
}

/** Opens the form of the check at the index. */
export function openCheck(env: AiEnv, index: number): void {
  const check = settingsChecks(env)[index];

  env.setCheckCursor(index);

  if (check) {
    env.setTask({ kind: "check", check });
  }
}

/** The keys of the AI settings, and on the Checks tab also the keys of the checks. */
export function handleSectionKey(env: AiEnv, input: string, key: Key): void {
  handleAiKey(env, input, key);

  if (env.page === "checks" && !key.ctrl && !key.meta) {
    handleChecksKey(env, input, key);
  }
}

/** The keys of the Checks tab: `c` the limits, `n` a new check, `↑/↓` select, `enter` edit, `d` remove. */
function handleChecksKey(env: AiEnv, input: string, key: Key): void {
  const checks = settingsChecks(env);
  const delta = moveDelta(input, key);
  const selected = checks[env.checkCursor];

  if (delta && checks.length > 0) {
    env.setCheckCursor((n) => Math.max(0, Math.min(checks.length - 1, n + delta)));

    return;
  }

  if (input === "c" && env.settings.data) {
    env.setTask({ kind: "checkLimits" });

    return;
  }

  if (input === "n") {
    env.setTask({ kind: "check" });

    return;
  }

  if (key.return && selected) {
    openCheck(env, env.checkCursor);

    return;
  }

  if (input === "d" && selected) {
    env.setTask({ kind: "removeCheck", check: selected });
  }
}
