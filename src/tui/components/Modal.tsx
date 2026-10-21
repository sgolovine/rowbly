import { type ReactNode, useContext, useId, useLayoutEffect } from 'react';
import { ActiveContext, ScreenDepthContext } from '../hooks';
import type { KeyHint } from '../keymap';
import { theme } from '../theme';
import { ModalFrame } from './ModalFrame';
import { LayerHostContext, LayerWrapContext } from './modalLayer';

export { MODAL_MIN_WIDTH, modalSize } from './modalSize';

/** Filled behind the modal so the screen below does not show through. */
export const MODAL_BACKGROUND = theme.overlay;

export interface ModalProps {
  title?: string;
  /** Shown along the bottom edge, e.g. the keys of the screen inside. */
  hints?: readonly KeyHint[];
  /**
   * `panel` and `dialog` fit a short task; only core uses `screen` for fixed Story/Settings frames.
   */
  size?: 'panel' | 'dialog' | 'screen';
  focused?: boolean;
  /** Widest the modal grows, in terminal columns; it never exceeds the room around it. */
  maxWidth?: number;
  /** Shows a clickable `✕` in the top edge that calls this; the keys that close the modal stay its parent's. */
  onClose?(): void;
  children: ReactNode;
}

/**
 * A framed task centred over the area it is rendered in. Opened inside another modal's content,
 * such as a Story tab, it is drawn as a layer over that modal's body instead, so the content's
 * scrolling does not clip it; it keeps the keys and the Plugin boundary of where it was opened.
 */
export function Modal(props: ModalProps) {
  const host = useContext(LayerHostContext);
  const active = useContext(ActiveContext);
  const depth = useContext(ScreenDepthContext);
  const wrap = useContext(LayerWrapContext);
  const id = useId();
  useLayoutEffect(() => {
    if (!host) return;
    host.show(
      id,
      wrap(
        <ScreenDepthContext.Provider value={depth}>
          <ActiveContext.Provider value={active}>
            <ModalFrame {...props} />
          </ActiveContext.Provider>
        </ScreenDepthContext.Provider>,
      ),
    );
  });
  useLayoutEffect(() => (host ? () => host.hide(id) : undefined), [host, id]);
  return host ? null : <ModalFrame {...props} />;
}
