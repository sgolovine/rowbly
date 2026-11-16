import { type Key, useInput, usePaste } from "ink";
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import {
  MAX_ATTACHMENT_BYTES,
  type PendingImage,
  readClipboardAttachment,
} from "../../services/attachment/attachment.js";
import { ValidationError } from "../../services/errors/errors.js";
import { Store } from "../../services/store/store.js";
import { useCovered } from "../components/index.js";
import { useLatest, writeRef } from "./refs.js";
import { useDirty, useIsActive } from "./shell.js";
import { showToast, type ToastStore, useToast } from "./toasts.js";

// A read stays busy after its original screen closes.
const clipboard = new Store({ reading: false });

export const PASTE_HINT = { key: process.platform === "win32" ? "alt+v" : "ctrl+v", description: "paste file" };

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

/** Reads the copied file or image of the clipboard and adds it to the draft. */
async function readImage(env: PasteEnv, session: number): Promise<void> {
  const file = await readClipboardAttachment({}, env.storyId);

  if (!isCurrent(env, session)) {
    return;
  }

  if (totalBytes(env.images.current) + file.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError("Pending files exceed 10 MiB in total");
  }

  env.setPending([...env.images.current, file]);
  showToast(env.toast, "info", "File added to draft; save the Story to keep it");
}

async function paste(env: PasteEnv): Promise<void> {
  if (!env.allowed || clipboard.current.reading) {
    return;
  }

  const session = env.generation.current;

  clipboard.update(() => ({ reading: true }));
  env.setBusy(true);

  const progress = env.toast.pending("Reading clipboard…");

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

/** An empty bracketed paste is the paste of a file or an image in some terminals. */
function pasteText(env: PasteEnv, text: string): void {
  if (text === "") {
    void paste(env);
  }
}

function pasteSummary(pending: readonly PendingImage[]): string | undefined {
  return pending.length
    ? `${pending.length} pending file${pending.length === 1 ? "" : "s"} · ${totalBytes(pending)} bytes`
    : undefined;
}

/** Pastes a copied file or a clipboard image into the draft of the Story `owner` while its screen is active. */
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
