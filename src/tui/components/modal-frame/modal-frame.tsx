import { Box } from "ink";
import { LayoutContext } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { CloseButton } from "../close-button/index.js";
import { LayerOutlet } from "../layer-outlet/index.js";
import type { ModalProps } from "../modal/index.js";
import { ModalBody } from "../modal-body/index.js";
import { ModalFooter } from "../modal-footer/index.js";
import { ModalLayerContext } from "../modal-layer.js";
import { MODAL_MIN_WIDTH } from "../modal-size.js";
import { Panel } from "../panel/index.js";
import { useModalFrame } from "./use-modal-frame.js";

/**
 * Draws a `Modal`: a framed panel centred over the area it is rendered in, the title in its border,
 * the content, and a hint bar. Modals opened inside its content are drawn over its body or, for a
 * generic modal that only fits its content, over the area around it; while one is open the frame
 * and its hints go quiet. Without a fixed height (tests, piped output) there
 * is nothing to cover, so it is shown below the content instead, sized to fit.
 */
export function ModalFrame(props: ModalProps) {
  const frame = useModalFrame(props);

  const { title, onClose, flush = false, children } = props;
  const { screen, overlay, top, footer, width, room, floatLayers } = frame;
  const layers = (
    <ModalLayerContext.Provider value={frame.registerLayer}>
      <LayoutContext.Provider value={floatLayers ? frame.outer : frame.bodyLayout}>
        <LayerOutlet host={frame.host} />
      </LayoutContext.Provider>
    </ModalLayerContext.Provider>
  );
  const panel = (
    <Panel
      title={title}
      paddingX={0}
      aside={onClose && top && <CloseButton onClick={onClose} />}
      focused={top}
      backgroundColor={overlay ? theme.overlay : undefined}
      // A screen modal keeps its size; a generic one fits its content between the bounds.
      width={screen ? width : undefined}
      minWidth={screen ? undefined : Math.min(MODAL_MIN_WIDTH, width)}
      height={screen ? room : undefined}
      maxWidth={width}
      maxHeight={room}
    >
      <ModalBody
        layout={frame.bodyLayout}
        flush={flush}
        scroll={!screen}
        covered={frame.covered}
        host={frame.host}
        registerLayer={frame.registerLayer}
        registerForm={frame.registerForm}
        layers={floatLayers ? undefined : layers}
      >
        {children}
      </ModalBody>
      {footer && <ModalFooter hints={footer} onClose={frame.info} top={top} width={width} />}
    </Panel>
  );

  if (!overlay) {
    return <Box alignSelf="flex-start">{panel}</Box>;
  }

  // An absolute box is placed in its direct parent, which may be only as tall as its content (a
  // Board with no Stories), so the height is the known room rather than `100%` of the parent.
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height={frame.outer.height}
      justifyContent="center"
      alignItems="center"
    >
      {panel}
      {floatLayers && layers}
    </Box>
  );
}
