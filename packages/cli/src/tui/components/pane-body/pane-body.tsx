import type { ReactNode } from "react";
import { type Layout, LayoutContext } from "../../hooks/index.js";
import { LayerOutlet } from "../layer-outlet/index.js";
import { ModalBody } from "../modal-body/index.js";
import { ModalLayerContext } from "../modal-layer.js";
import type { ModalLayers } from "../use-modal-layers.js";

export interface PaneBodyProps {
  /** The layers and the Form keys of the pane, from `useModalLayers`. */
  readonly layers: ModalLayers;
  /** The size of the content. */
  readonly layout: Layout;
  /** No padding, for content that draws its own frames up to the edge of the pane. */
  readonly flush: boolean;
  /** The content scrolls in the body. */
  readonly scroll: boolean;
  readonly children: ReactNode;
}

/**
 * The body of a pane that holds a Form outside a Modal, for example the Story sidebar. It gives the content
 * the contexts of a Modal body, so a Modal that the content opens, for example a `ConfirmDialog`, shows as a
 * layer over the body, and the content does not take the keys while the layer is open.
 */
export function PaneBody({ layers, layout, flush, scroll, children }: PaneBodyProps) {
  return (
    <ModalBody
      layout={layout}
      flush={flush}
      scroll={scroll}
      covered={layers.covered}
      host={layers.host}
      registerLayer={layers.registerLayer}
      registerForm={layers.registerForm}
      layers={
        <ModalLayerContext.Provider value={layers.registerLayer}>
          <LayoutContext.Provider value={layout}>
            <LayerOutlet host={layers.host} />
          </LayoutContext.Provider>
        </ModalLayerContext.Provider>
      }
    >
      {children}
    </ModalBody>
  );
}
