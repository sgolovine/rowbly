import { Box, Text } from "ink";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LayoutContext, uniqueKeys, useIsActive, useLayout } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { theme } from "../../theme.js";
import { Button } from "../Button/index.js";
import { CloseButton } from "../CloseButton/index.js";
import { fitHints, hintsWidth } from "../fitHints.js";
import { KeyHints } from "../KeyHints/index.js";
import { LayerOutlet } from "../LayerOutlet/index.js";
import type { ModalProps } from "../Modal/index.js";
import {
  CoveredContext,
  createLayerHost,
  FormKeysContext,
  LayerHostContext,
  ModalLayerContext,
} from "../modalLayer.js";
import { MODAL_MIN_WIDTH, modalSize } from "../modalSize.js";
import { Panel } from "../Panel/index.js";
import { ScrollBody } from "../ScrollBody/index.js";

const FORM_ESC = { key: "esc", description: "cancel" };
const CLOSE = "Close";
// The Close Button's width: its padding, label, gap and `esc` key cap.
const CLOSE_WIDTH = 1 + CLOSE.length + 1 + " esc ".length + 1;

/**
 * Draws a `Modal`: a framed panel centred over the area it is rendered in, the title in its border,
 * the content, and a hint bar. Modals opened inside its content are drawn over its body or, for a
 * generic modal that only fits its content, over the area around it; while one is open the frame
 * and its hints go quiet. Without a fixed height (tests, piped output) there
 * is nothing to cover, so it is shown below the content instead, sized to fit.
 */
export function ModalFrame({
  title,
  hints,
  size = "panel",
  maxWidth = size === "screen" ? 120 : 72,
  onClose,
  focused = true,
  flush = false,
  children,
}: ModalProps) {
  const parentLayer = useContext(ModalLayerContext);
  const active = useIsActive();
  const [nested, setNested] = useState(0);
  const registerLayer = useCallback(() => {
    setNested((count) => count + 1);
    return () => setNested((count) => count - 1);
  }, []);
  useEffect(() => parentLayer?.(), [parentLayer]);
  const [leads, setLeads] = useState<readonly { keys: readonly KeyHint[] }[]>([]);
  const registerForm = useCallback((keys: readonly KeyHint[]) => {
    const entry = { keys };
    setLeads((list) => [...list, entry]);
    return () => setLeads((list) => list.filter((other) => other !== entry));
  }, []);
  const [host] = useState(createLayerHost);
  const outer = useLayout();
  const screen = size === "screen";
  const overlay = outer.height !== undefined;
  const covered = nested > 0;
  // Only the top layer, the one in focus, shows its frame in accent, its `✕` and its keys.
  const top = focused && active && !covered;
  // A titled modal without hints still says how to close it. A Form inside adds its keys first, and
  // there `esc` cancels.
  const own = hints?.length ? hints : title ? [{ key: "esc", description: "close" }] : undefined;
  const footer =
    leads.length > 0
      ? uniqueKeys([
          ...leads.flatMap((lead) => lead.keys),
          ...(own ?? []).filter((hint) => hint.key !== "esc"),
          FORM_ESC,
        ])
      : own;
  // An info modal only shows information: its one key is `esc`, so it offers a Close Button instead
  // of the hint strip. Screen Modals keep their strip.
  const info = !screen && leads.length === 0 && footer?.length === 1 && footer[0]?.key === "esc" ? onClose : undefined;
  const { width, room, body } = modalSize(outer, { size, maxWidth, footer: footer !== undefined, flush });
  // Kept stable, so content that reads the layout does not render again whenever a layer shows.
  const bodyLayout = useMemo(() => ({ width: body.width, height: body.height }), [body.width, body.height]);
  // A generic modal fits its content, so its body can be too short for a layer, and the body clips what
  // it holds. Its layers go over the area around the modal instead.
  const floatLayers = overlay && !screen;
  const layers = (
    <ModalLayerContext.Provider value={registerLayer}>
      <LayoutContext.Provider value={floatLayers ? outer : bodyLayout}>
        <LayerOutlet host={host} />
      </LayoutContext.Provider>
    </ModalLayerContext.Provider>
  );
  const frame = (
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
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        overflow="hidden"
        paddingX={flush ? 0 : 2}
        paddingY={flush ? 0 : 1}
      >
        <LayoutContext.Provider value={bodyLayout}>
          <ModalLayerContext.Provider value={registerLayer}>
            <LayerHostContext.Provider value={host}>
              <CoveredContext.Provider value={covered}>
                <FormKeysContext.Provider value={registerForm}>
                  {screen ? (
                    children
                  ) : (
                    <ScrollBody active={!covered} height={body.height}>
                      {children}
                    </ScrollBody>
                  )}
                </FormKeysContext.Provider>
              </CoveredContext.Provider>
            </LayerHostContext.Provider>
          </ModalLayerContext.Provider>
          {!floatLayers && layers}
        </LayoutContext.Provider>
      </Box>
      {footer && (
        <Box
          // The Close Button pads its own label, so it lines up with the body text.
          paddingX={info ? 1 : 2}
          flexShrink={0}
          borderStyle="single"
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor={theme.border}
        >
          {/* Under another layer, the strip or the Close Button keeps its line and its width, so the frame does not move or resize. */}
          {info && top ? (
            <Button label={CLOSE} keyName="esc" onClick={info} clickable compact />
          ) : info ? (
            <Text>{" ".repeat(CLOSE_WIDTH)}</Text>
          ) : top ? (
            <KeyHints hints={footer} width={width - 6} />
          ) : (
            <Text>{" ".repeat(Math.max(1, hintsWidth(fitHints(footer, width - 6))))}</Text>
          )}
        </Box>
      )}
    </Panel>
  );
  if (!overlay) return <Box alignSelf="flex-start">{frame}</Box>;
  // An absolute box is placed in its direct parent, which may be only as tall as its content (a
  // Board with no Stories), so the height is the known room rather than `100%` of the parent.
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height={outer.height}
      justifyContent="center"
      alignItems="center"
    >
      {frame}
      {floatLayers && layers}
    </Box>
  );
}
