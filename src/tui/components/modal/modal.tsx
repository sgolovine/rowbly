import { type ReactNode, useContext, useId, useLayoutEffect } from "react";
import { ActiveContext, ScreenDepthContext } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { ModalFrame } from "../modal-frame/index.js";
import { LayerHostContext, LayerWrapContext } from "../modal-layer.js";

export { modalSize } from "../modal-size.js";

export interface ModalProps {
  title?: string;
  /** Shown along the bottom edge, e.g. the keys of the screen inside. */
  hints?: readonly KeyHint[];
  /**
   * `panel` and `dialog` fit a short task; only core uses `screen` for fixed Story/Settings frames.
   */
  size?: "panel" | "dialog" | "screen";
  focused?: boolean;
  /** The body has no padding, for content that draws its own frames up to the edge of the modal. */
  flush?: boolean;
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
