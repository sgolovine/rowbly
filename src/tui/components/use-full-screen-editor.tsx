import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useMainOverlay, writeRef } from "../hooks/index.js";
import { FullScreenEditor, type FullScreenEditorProps } from "./full-screen-editor/index.js";

type FullScreenEditorOptions = Omit<FullScreenEditorProps, "onClose"> & {
  /** Called after the editor has closed. */
  onClose?(): void;
};

export interface FullScreenEditorControl {
  /** Opens the editor over the whole terminal. */
  open(options: FullScreenEditorOptions): void;
  /** Whether it is open; the opener takes no keys meanwhile. */
  isOpen: boolean;
  /** The editor to render where the opener is, outside the shell, where there is nothing to cover; otherwise null. */
  inline: ReactNode;
}

/** Builds a new editor. Each opening has a new key, so it never keeps the state of the last one. */
function openEditor(
  opened: RefObject<number>,
  setNode: Dispatch<SetStateAction<ReactNode>>,
  options: FullScreenEditorOptions,
): void {
  writeRef(opened, opened.current + 1);
  setNode(<FullScreenEditor key={opened.current} {...options} onClose={() => closeEditor(setNode, options)} />);
}

function closeEditor(setNode: Dispatch<SetStateAction<ReactNode>>, options: FullScreenEditorOptions): void {
  setNode(null);
  options.onClose?.();
}

/**
 * Opens a `FullScreenEditor` over the whole terminal, above the screens and the shell. The editor is
 * built when it opens: it holds the text from then on and reports through its callbacks.
 */
export function useFullScreenEditor(): FullScreenEditorControl {
  const overlay = useMainOverlay();
  const id = useId();
  const [node, setNode] = useState<ReactNode>(null);
  // Each opening is a new editor, never the state of the last one.
  const opened = useRef(0);
  const open = useCallback((options: FullScreenEditorOptions) => openEditor(opened, setNode, options), []);

  useEffect(() => {
    if (!node || !overlay) {
      return;
    }

    overlay.open(id, node);

    return () => overlay.close(id);
  }, [node, overlay, id]);

  return { open, isOpen: node !== null, inline: overlay ? null : node };
}
