import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import {
  type Attachment,
  addAttachment,
  openAttachment,
  removeAttachment,
} from "../../../../services/attachment/attachment.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import type { ToastStore } from "../../../hooks/index.js";
import { moveDelta } from "../../../keymap.js";
import { toastInfo } from "../toast-info.js";

/** The question that the Attachments tab asks: the path of a new PNG, or the removal of an image. */
export type AttachmentTask = "path" | "remove" | null;

/** The environment of the handlers of the Attachments tab. */
export interface AttachmentsTabEnv {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  readonly toast: ToastStore;
  readonly count: number;
  /** The selected attachment. */
  readonly item: Attachment | undefined;
  readonly setTask: Dispatch<SetStateAction<AttachmentTask>>;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly reload: () => void;
}

/** Opens the selected attachment in the viewer of the system. */
export function openItem(env: AttachmentsTabEnv): void {
  if (env.item) {
    void openAttachment({ story: env.storyId, id: env.item.id }, env.ctx).catch(env.toast.error);
  }
}

/** The arrows move the selection, `n` adds a PNG, `o` opens and `d` removes the selected image. */
export function handleKey(env: AttachmentsTabEnv, input: string, key: Key): void {
  const delta = moveDelta(input, key);

  if (delta) {
    env.setCursor((n) => Math.max(0, Math.min(env.count - 1, n + delta)));
  } else if (input === "n") {
    env.setTask("path");
  } else if (input === "o") {
    openItem(env);
  } else if (input === "d" && env.item) {
    env.setTask("remove");
  }
}

/** Attaches the PNG at the path from the form. */
export async function attachFile(env: AttachmentsTabEnv, values: FormValues): Promise<void> {
  await addAttachment({ story: env.storyId, file: String(values.path) }, env.ctx);
  env.setTask(null);
  env.reload();
  toastInfo(env.toast, "PNG attached");
}

/** Closes the question and removes `item`. */
export function confirmRemove(env: AttachmentsTabEnv, item: Attachment): void {
  env.setTask(null);
  void removeAttachment({ story: env.storyId, id: item.id }, env.ctx).then(() => env.reload(), env.toast.error);
}
