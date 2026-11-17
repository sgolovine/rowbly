import type { Key } from "ink";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { FormValues } from "../../../components/index.js";
import { runExclusive, type useStoryPaste } from "../../../hooks/index.js";
import { isSubmitKey } from "../../../keymap.js";
import type { StoryConfirm } from "../story-confirm-dialogs/index.js";
import type { StoryTabId } from "../story-tab-panes/index.js";
import { nextTabId } from "./story-modal-body-view.js";

/** The environment of the handlers of the Story Modal. */
export interface StoryModalBodyEnv {
  readonly tabIds: readonly StoryTabId[];
  /** The index of the tab on the screen. */
  readonly tab: number;
  readonly shown: StoryTabId;
  /** The text editor of the Specs tab has the keys. */
  readonly specEditing: boolean;
  /** The Attachments tab asks a question, or the Models tab has its picker open. */
  readonly attachmentTask: boolean;
  readonly paste: ReturnType<typeof useStoryPaste>;
  /** True while a save runs, so that a second save key does not save again. */
  readonly savingNow: RefObject<boolean>;
  readonly setTabId: Dispatch<SetStateAction<StoryTabId>>;
  readonly setSubmitRequest: Dispatch<SetStateAction<number>>;
  readonly setSaving: Dispatch<SetStateAction<boolean>>;
  readonly onSubmit: (values: FormValues, attachments?: readonly PendingImage[]) => void | Promise<void>;
  readonly onConfirming: (confirm: StoryConfirm) => void;
}

/** `shift+tab` goes to the next tab, the save key asks the Form to save, and `ctrl+d` on the General tab deletes. */
export function handleBodyKey(env: StoryModalBodyEnv, input: string, key: Key): void {
  if (key.tab && key.shift) {
    env.setTabId(nextTabId(env.tabIds, env.tab));
  } else if (!env.specEditing && !env.attachmentTask && isSubmitKey(input, key)) {
    env.setSubmitRequest((n) => n + 1);
  } else if (env.shown === "general" && key.ctrl && input === "d") {
    env.onConfirming("delete");
  }
}

/** Saves the Story with the pasted images, unless a paste or an earlier save has not finished. */
export async function submitStory(env: StoryModalBodyEnv, values: FormValues): Promise<void> {
  if (env.paste.busy) {
    return;
  }

  await runExclusive(env.savingNow, () => saveTask(env, values));
}

async function saveTask(env: StoryModalBodyEnv, values: FormValues): Promise<void> {
  env.setSaving(true);

  try {
    await env.onSubmit(values, env.paste.pending);
    env.paste.saved();
  } finally {
    env.setSaving(false);
  }
}
