import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import {
  DEFAULT_COMMIT_MESSAGE,
  formatAuthor,
  gitSync,
  MAX_SYNC_SECONDS,
  MIN_SYNC_SECONDS,
} from "../../../../services/factory-settings/git-settings.js";
import type { FormField } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";

/** The value that a form on top of the Git settings edits. */
export type GitTextKey = "author" | "message" | "interval";

/** The task on top of the Git settings: the form of one value, or nothing. */
export type GitTask = GitTextKey | null;

/** The texts of the five cards. Each is `—` before the settings load. */
export interface GitTexts {
  readonly author: string;
  readonly message: string;
  readonly push: string;
  readonly pull: string;
  readonly interval: string;
}

/** The form of one value: its title, its field and the value at the start. */
export interface GitForm {
  readonly title: string;
  readonly field: FormField;
  readonly initial: string | number;
  /** What the field takes, above the field. */
  readonly note: string;
}

const NO_VALUE = "—";

export const DEFAULT_AUTHOR_TEXT = "Git config identity";

/** The bounds of the sync interval, as text for the hints of a form and an error. */
export const INTERVAL_RANGE = `a whole number from ${MIN_SYNC_SECONDS} to ${MAX_SYNC_SECONDS}`;

const GIT_HINTS: readonly KeyHint[] = [
  { key: "a", description: "author" },
  { key: "m", description: "message" },
  { key: "p", description: "toggle push" },
  { key: "u", description: "toggle pull" },
  { key: "i", description: "interval" },
];

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

/** The card texts of the settings. A value that is not set shows its default. */
export function gitTexts(settings: FactorySettings | undefined): GitTexts {
  if (!settings) {
    return { author: NO_VALUE, message: NO_VALUE, push: NO_VALUE, pull: NO_VALUE, interval: NO_VALUE };
  }

  const sync = gitSync(settings.git);

  return {
    author: formatAuthor(settings.git) ?? DEFAULT_AUTHOR_TEXT,
    message: settings.git?.commitMessage ?? DEFAULT_COMMIT_MESSAGE,
    push: onOff(sync.push),
    pull: onOff(sync.pull),
    interval: `${sync.syncIntervalSeconds} seconds`,
  };
}

/** The form of a value, with the value of the settings at the start. An empty author or message clears it. */
export function gitForm(task: GitTextKey, settings: FactorySettings | undefined): GitForm {
  if (task === "author") {
    return {
      title: "Git › Commit author",
      field: { name: "author", label: "Author", kind: "text" },
      initial: formatAuthor(settings?.git) ?? "",
      note: "Name <email>. An empty value uses the Git config identity.",
    };
  }

  if (task === "message") {
    return {
      title: "Git › Commit message",
      field: { name: "message", label: "Message", kind: "text" },
      initial: settings?.git?.commitMessage ?? "",
      note: `An empty value uses the default message: ${DEFAULT_COMMIT_MESSAGE}`,
    };
  }

  return {
    title: "Git › Sync interval",
    field: { name: "interval", label: "Seconds", kind: "number", required: true },
    initial: gitSync(settings?.git).syncIntervalSeconds,
    note: `The seconds between two syncs: ${INTERVAL_RANGE}.`,
  };
}

/** The keys of the Git settings. While a form is on top, the form shows its own keys. */
export function gitHints(idle: boolean): readonly KeyHint[] {
  return idle ? GIT_HINTS : [];
}
