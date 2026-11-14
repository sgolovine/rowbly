import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { ValidationError } from "../../../../services/errors/errors.js";
import {
  configureGit,
  type FactorySettings,
  type GitInput,
} from "../../../../services/factory-settings/factory-settings.js";
import { formatAuthor, gitSync } from "../../../../services/factory-settings/git-settings.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { type AsyncState, showToast, type ToastStore } from "../../../hooks/index.js";
import { type GitTask, type GitTextKey, INTERVAL_RANGE } from "./git-view.js";

/** What the handlers of the Git settings read and change. */
export interface GitEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly settings: AsyncState<FactorySettings>;
  readonly setTask: Dispatch<SetStateAction<GitTask>>;
  readonly onChange: () => void;
}

/** The sync switches that a key toggles. */
type SyncSwitch = "push" | "pull";

/** Closes the form. A change reads the settings again, also behind Settings. */
function finishChange(env: GitEnv, message: string): void {
  showToast(env.toast, "info", message);
  env.setTask(null);
  env.settings.reload();
  env.onChange();
}

/** Gives a `ValidationError` of the service the path of the form field, so that the form shows it there. */
function fieldError(field: GitTextKey, error: unknown): unknown {
  if (!(error instanceof ValidationError)) {
    return error;
  }

  const message = field === "interval" ? `must be ${INTERVAL_RANGE}` : error.message;

  return new ValidationError(error.message, { hint: error.hint, details: { issues: [{ path: [field], message }] } });
}

/** Writes the Git input. A validation error of the service shows under the field of the form. */
function writeGit(env: GitEnv, field: GitTextKey, input: GitInput): Promise<FactorySettings> {
  return configureGit(input, env.ctx).catch((error: unknown) => Promise.reject(fieldError(field, error)));
}

function textOf(values: FormValues, name: string): string {
  const value = values[name];

  return typeof value === "string" ? value : "";
}

/** Saves the commit author, as `Name <email>`. An empty value clears it, so that Git uses its own identity. */
export async function saveAuthor(env: GitEnv, values: FormValues): Promise<void> {
  const settings = await writeGit(env, "author", { commitAuthor: textOf(values, "author") });
  const author = formatAuthor(settings.git);

  finishChange(env, author ? `Saved the commit author: ${author}` : "Cleared the commit author");
}

/** Saves the commit message. An empty value clears it, so that the factory uses the default message. */
export async function saveMessage(env: GitEnv, values: FormValues): Promise<void> {
  const settings = await writeGit(env, "message", { commitMessage: textOf(values, "message") });
  const message = settings.git?.commitMessage;

  finishChange(env, message ? `Saved the commit message: ${message}` : "Cleared the commit message");
}

/** Saves the sync interval. The service rejects a value that is not a whole number in its range. */
export async function saveInterval(env: GitEnv, values: FormValues): Promise<void> {
  const value = values.interval;
  const seconds = typeof value === "number" ? value : Number.NaN;

  const settings = await writeGit(env, "interval", { gitSyncInterval: seconds });

  finishChange(env, `Saved the sync interval: ${gitSync(settings.git).syncIntervalSeconds} seconds`);
}

/** Turns periodic push or pull on or off. A failure shows a toast. */
export function toggleSync(env: GitEnv, name: SyncSwitch): void {
  const current = env.settings.data;

  if (!current) {
    return;
  }

  const on = !gitSync(current.git)[name];
  const input: GitInput = name === "push" ? { gitPush: on } : { gitPull: on };

  configureGit(input, env.ctx).then(
    () => finishChange(env, `Periodic ${name} ${on ? "on" : "off"}`),
    (error: unknown) => env.toast.error(error),
  );
}

const FORM_KEYS: Readonly<Record<string, GitTextKey>> = { a: "author", m: "message", i: "interval" };
const SWITCH_KEYS: Readonly<Record<string, SyncSwitch>> = { p: "push", u: "pull" };

/** The keys of the Git settings: `a`, `m` and `i` open a form, `p` and `u` toggle push and pull. */
export function handleGitKey(env: GitEnv, input: string, key: Key): void {
  if (key.ctrl || key.meta || !env.settings.data) {
    return;
  }

  const form = FORM_KEYS[input];
  const sync = SWITCH_KEYS[input];

  if (form) {
    env.setTask(form);

    return;
  }

  if (sync) {
    toggleSync(env, sync);
  }
}
