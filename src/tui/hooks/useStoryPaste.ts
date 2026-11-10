import { useInput, usePaste } from "ink";
import { useEffect, useRef, useState } from "react";
import { clipboardName, MAX_ATTACHMENT_BYTES, type PendingImage } from "../../services/attachment/attachment.js";
import { clipboardFailure, readClipboardImage } from "../../services/clipboard/clipboard.js";
import { ValidationError } from "../../services/errors/errors.js";
import { useCovered } from "../components/index.js";
import { useDirty, useIsActive } from "./shell.js";
import { useToast } from "./toasts.js";

// A read stays busy after its original screen closes.
let reading = false;
export const IMAGE_PASTE_HINT = { key: process.platform === "win32" ? "alt+v" : "ctrl+v", description: "paste image" };
export function useStoryPaste(owner: string, storyId?: string, enabled = true) {
  const active = useIsActive();
  const covered = useCovered();
  const toast = useToast();
  const allowed = active && !covered && enabled;
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const latest = useRef({ allowed, owner });
  latest.current = { allowed, owner };
  const images = useRef(pending);
  images.current = pending;
  // biome-ignore lint/correctness/useExhaustiveDependencies: owner and focus changes invalidate a clipboard read.
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [owner, allowed]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: drafts belong to one owner.
  useEffect(() => {
    setPending([]);
  }, [owner]);
  useDirty(pending.length > 0);
  const paste = async () => {
    if (!allowed || reading) return;
    const session = generation.current;
    const current = () => generation.current === session && latest.current.allowed && latest.current.owner === owner;
    reading = true;
    setBusy(true);
    const progress = toast.pending("Reading clipboard image…");
    try {
      const result = await readClipboardImage();
      if (!current()) return;
      if ("reason" in result) throw clipboardFailure(result.reason, storyId);
      const size = images.current.reduce((n, image) => n + image.bytes.length, 0) + result.bytes.length;
      if (size > MAX_ATTACHMENT_BYTES) throw new ValidationError("Pending images exceed 10 MiB in total");
      setPending([...images.current, { name: clipboardName(new Date()), bytes: result.bytes }]);
      toast.push("info", "Image added to draft; save the Story to keep it");
    } catch (err) {
      if (current()) toast.error(err);
    } finally {
      reading = false;
      setBusy(false);
      toast.dismiss(progress);
    }
  };
  useInput(
    (input, key) => {
      if (input === "v" && (key.ctrl || key.meta)) void paste();
    },
    { isActive: allowed },
  );
  usePaste(
    (text) => {
      if (text === "") void paste();
    },
    { isActive: allowed },
  );
  return {
    pending,
    busy,
    saved: () => setPending([]),
    summary: pending.length
      ? `${pending.length} pending image${pending.length === 1 ? "" : "s"} · ${pending.reduce((n, image) => n + image.bytes.length, 0)} bytes`
      : undefined,
  };
}
