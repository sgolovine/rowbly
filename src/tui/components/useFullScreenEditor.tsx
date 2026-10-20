import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMainOverlay } from '../hooks';
import { FullScreenEditor, type FullScreenEditorProps } from './FullScreenEditor';

export type FullScreenEditorOptions = Omit<FullScreenEditorProps, 'onClose'> & {
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
  const open = useCallback((options: FullScreenEditorOptions) => {
    opened.current++;
    setNode(
      <FullScreenEditor
        key={opened.current}
        {...options}
        onClose={() => {
          setNode(null);
          options.onClose?.();
        }}
      />,
    );
  }, []);
  useEffect(() => {
    if (!node || !overlay) return;
    overlay.open(id, node);
    return () => overlay.close(id);
  }, [node, overlay, id]);
  return { open, isOpen: node !== null, inline: overlay ? null : node };
}
