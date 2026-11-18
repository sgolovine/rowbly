import { type Key, useInput } from "ink";
import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";
import { useKeyCapture, writeRef } from "../../hooks/index.js";
import type { SaveState } from "../save-status/index.js";

/** `view` shows the markdown rendered; `edit` shows the raw text in a `TextArea`. */
export type EditorMode = "view" | "edit";

export interface EditorStateOptions {
  readonly initial: string;
  readonly initialMode: EditorMode;
  readonly active: boolean;
  readonly onChange?: (value: string) => void;
  readonly onSave?: (value: string) => Promise<void>;
  readonly onClose: () => void;
}

interface EditorEnv {
  readonly mode: EditorMode;
  readonly dirty: boolean;
  readonly latest: RefObject<string>;
  readonly onChange?: (value: string) => void;
  readonly onSave?: (value: string) => Promise<void>;
  readonly onClose: () => void;
  readonly setValue: Dispatch<SetStateAction<string>>;
  readonly setMode: Dispatch<SetStateAction<EditorMode>>;
  readonly setSaved: Dispatch<SetStateAction<string>>;
  readonly setSave: Dispatch<SetStateAction<SaveState>>;
  readonly setConfirming: Dispatch<SetStateAction<boolean>>;
}

/** Closes the editor, or asks first when there are unsaved changes. */
function closeEditor(env: EditorEnv): void {
  if (env.dirty) {
    env.setConfirming(true);

    return;
  }

  env.onClose();
}

/** Saves the latest text, which can be newer than the last render. */
async function saveText(env: EditorEnv): Promise<void> {
  const text = env.latest.current;

  if (!env.onSave) {
    return;
  }

  env.setSave({ kind: "saving" });

  try {
    await env.onSave(text);
    env.setSaved(text);
    env.setSave({ kind: "saved" });
  } catch (err) {
    env.setSave({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
  }
}

function editText(env: EditorEnv, next: string): void {
  writeRef(env.latest, next);
  env.setValue(next);
  env.onChange?.(next);
}

function toggleMode(mode: EditorMode): EditorMode {
  return mode === "view" ? "edit" : "view";
}

function handleEditorKey(env: EditorEnv, close: () => void, input: string, key: Key): void {
  if (key.escape || (key.ctrl && input === "f")) {
    close();

    return;
  }

  if (key.tab) {
    env.setMode(toggleMode);

    return;
  }

  if (env.mode === "view" && input === "e" && !key.ctrl && !key.meta) {
    env.setMode("edit");

    return;
  }

  if (key.ctrl && input === "s") {
    saveOrClose(env, close);
  }
}

/** `ctrl+s` saves when there is `onSave`, and otherwise closes a field editor. */
function saveOrClose(env: EditorEnv, close: () => void): void {
  if (env.onSave) {
    void saveText(env);

    return;
  }

  close();
}

/** The text, the mode and the save of a `FullScreenEditor`, and its keys. */
export function useEditorState({ initial, initialMode, active, onChange, onSave, onClose }: EditorStateOptions) {
  const [value, setValue] = useState(initial);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [saved, setSaved] = useState(initial);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirming, setConfirming] = useState(false);
  // The latest text, for a save that starts before the edit's render.
  const latest = useRef(initial);

  const dirty = onSave !== undefined && value !== saved;
  const keys = active && !confirming && save.kind !== "saving";

  const env: EditorEnv = {
    mode,
    dirty,
    latest,
    onChange,
    onSave,
    onClose,
    setValue,
    setMode,
    setSaved,
    setSave,
    setConfirming,
  };
  const actions = {
    close: () => closeEditor(env),
    edit: (next: string) => editText(env, next),
  };

  // The shell leaves `esc` to the editor, rather than going back from the screen below.
  useKeyCapture(active, { escape: true });
  useInput((input, key) => handleEditorKey(env, actions.close, input, key), { isActive: keys });

  return { value, mode, setMode, save, dirty, keys, confirming, setConfirming, ...actions };
}
