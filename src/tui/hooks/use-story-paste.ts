import { type Key, useInput, usePaste } from "ink";
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import { clipboardName, MAX_ATTACHMENT_BYTES, type PendingImage } from "../../services/attachment/attachment.js";
import { clipboardFailure, readClipboardImage } from "../../services/clipboard/clipboard.js";
import { ValidationError } from "../../services/errors/errors.js";
import { Store } from "../../services/store/store.js";
import { useCovered } from "../components/index.js";
import { useLatest, writeRef } from "./refs.js";
import { useDirty, useIsActive } from "./shell.js";
import { showToast, type ToastStore, useToast } from "./toasts.js";

// A read stays busy after its original screen closes.
const clipboard = new Store({ reading: false });

export const IMAGE_PASTE_HINT = { key: process.platform === "win32" ? "alt+v" : "ctrl+v", description: "paste image" };

/** What a paste reads and changes. */
interface PasteEnv {
  readonly allowed: boolean;
  readonly owner: string;
  readonly storyId: string | undefined;
  readonly toast: ToastStore;
  readonly setPending: Dispatch<SetStateAction<PendingImage[]>>;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  /** Changes when the owner or the focus changes, so a read in flight knows that it is stale. */
  readonly generation: RefObject<number>;
  readonly latest: RefObject<{ allowed: boolean; owner: string }>;
  readonly images: RefObject<PendingImage[]>;
}

function nextGeneration(generation: RefObject<number>): void {
  writeRef(generation, generation.current + 1);
}

/** Whether the read of `session` still belongs to the screen that started it. */
function isCurrent(env: PasteEnv, session: number): boolean {
  return env.generation.current === session && env.latest.current.allowed && env.latest.current.owner === env.owner;
}

function totalBytes(images: readonly PendingImage[]): number {
  return images.reduce((n, image) => n + image.bytes.length, 0);
}

/** Reads the clipboard image and adds it to the draft. */
async function readImage(env: PasteEnv, session: number): Promise<void> {
  const result = await readClipboardImage();

  if (!isCurrent(env, session)) {
    return;
  }

  if ("reason" in result) {
    throw clipboardFailure(result.reason, env.storyId);
  }

  if (totalBytes(env.images.current) + result.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Pending images exceed 10 MiB in total");
  }

  env.setPending([...env.images.current, { name: clipboardName(new Date()), bytes: result.bytes }]);
  showToast(env.toast, "info", "Image added to draft; save the Story to keep it");
}

async function paste(env: PasteEnv): Promise<void> {
  if (!env.allowed || clipboard.current.reading) {
    return;
  }

  const session = env.generation.current;

  clipboard.update(() => ({ reading: true }));
  env.setBusy(true);

  const progress = env.toast.pending("Reading clipboard image…");

  try {
    await readImage(env, session);
  } catch (err) {
    if (isCurrent(env, session)) {
      env.toast.error(err);
    }
  } finally {
    clipboard.update(() => ({ reading: false }));
    env.setBusy(false);
    env.toast.dismiss(progress);
  }
}

function pasteKey(env: PasteEnv, input: string, key: Key): void {
  if (input === "v" && (key.ctrl || key.meta)) {
    void paste(env);
  }
}

/** An empty bracketed paste is the paste of an image in some terminals. */
function pasteText(env: PasteEnv, text: string): void {
  if (text === "") {
    void paste(env);
  }
}

function pasteSummary(pending: readonly PendingImage[]): string | undefined {
  return pending.length
    ? `${pending.length} pending image${pending.length === 1 ? "" : "s"} · ${totalBytes(pending)} bytes`
    : undefined;
}

/** Pastes clipboard images into the draft of the Story `owner` while its screen is active. */
export function useStoryPaste(owner: string, storyId?: string, enabled = true) {
  const active = useIsActive();
  const covered = useCovered();
  const toast = useToast();
  const allowed = active && !covered && enabled;
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const latest = useLatest({ allowed, owner });
  const images = useLatest(pending);

  const env: PasteEnv = { allowed, owner, storyId, toast, setPending, setBusy, generation, latest, images };

  // biome-ignore lint/correctness/useExhaustiveDependencies: owner and focus changes invalidate a clipboard read.
  useEffect(() => {
    nextGeneration(generation);

    return () => nextGeneration(generation);
  }, [owner, allowed]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: drafts belong to one owner.
  useEffect(() => {
    setPending([]);
  }, [owner]);
  useDirty(pending.length > 0);
  useInput((input, key) => pasteKey(env, input, key), { isActive: allowed });
  usePaste((text) => pasteText(env, text), { isActive: allowed });

  return {
    pending,
    busy,
    saved: () => setPending([]),
    summary: pasteSummary(pending),
  };
}
