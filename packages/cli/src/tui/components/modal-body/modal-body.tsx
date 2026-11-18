import { Box } from "ink";
import type { ReactNode } from "react";
import { type Layout, LayoutContext } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import {
  CoveredContext,
  FormKeysContext,
  type LayerHost,
  LayerHostContext,
  ModalLayerContext,
} from "../modal-layer.js";
import { ScrollBody } from "../scroll-body/index.js";

export interface ModalBodyProps {
  /** The size of the body, for the content that reads the layout. */
  readonly layout: Layout;
  /** No padding, for content that draws its own frames up to the edge of the modal. */
  readonly flush: boolean;
  /** The content scrolls in the body. A screen modal lays out its own content. */
  readonly scroll: boolean;
  /** A task is open over the content. */
  readonly covered: boolean;
  readonly host: LayerHost;
  readonly registerLayer: () => () => void;
  readonly registerForm: (keys: readonly KeyHint[]) => () => void;
  /** The layers over the body, when they show in the body and not around the modal. */
  readonly layers?: ReactNode;
  readonly children: ReactNode;
}

/** The body of a `ModalFrame`: the content with the contexts of the modal, and the layers over it. */
export function ModalBody({
  layout,
  flush,
  scroll,
  covered,
  host,
  registerLayer,
  registerForm,
  layers,
  children,
}: ModalBodyProps) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      overflow="hidden"
      paddingX={flush ? 0 : 2}
      paddingY={flush ? 0 : 1}
    >
      <LayoutContext.Provider value={layout}>
        <ModalLayerContext.Provider value={registerLayer}>
          <LayerHostContext.Provider value={host}>
            <CoveredContext.Provider value={covered}>
              <FormKeysContext.Provider value={registerForm}>
                {scroll ? (
                  <ScrollBody active={!covered} height={layout.height}>
                    {children}
                  </ScrollBody>
                ) : (
                  children
                )}
              </FormKeysContext.Provider>
            </CoveredContext.Provider>
          </LayerHostContext.Provider>
        </ModalLayerContext.Provider>
        {layers}
      </LayoutContext.Provider>
    </Box>
  );
}
