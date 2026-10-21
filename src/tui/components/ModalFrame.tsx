import { Box, Text } from 'ink';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LayoutContext, uniqueKeys, useIsActive, useLayout } from '../hooks';
import { FORM_KEYS } from '../keymap';
import { theme } from '../theme';
import { CloseButton } from './CloseButton';
import { KeyHints } from './KeyHints';
import { LayerOutlet } from './LayerOutlet';
import type { ModalProps } from './Modal';
import { CoveredContext, createLayerHost, FormKeysContext, LayerHostContext, ModalLayerContext } from './modalLayer';
import { MODAL_MIN_WIDTH, modalSize } from './modalSize';
import { Panel } from './Panel';
import { ScrollBody } from './ScrollBody';

const FORM_ESC = { key: 'esc', description: 'cancel' };

/**
 * Draws a `Modal`: a framed panel centred over the area it is rendered in, the title in its border,
 * the content, and a hint bar. Modals opened inside its content are drawn over its body, and while
 * one is open the frame and its hints go quiet. Without a fixed height (tests, piped output) there
 * is nothing to cover, so it is shown below the content instead, sized to fit.
 */
export function ModalFrame({
  title,
  hints,
  size = 'panel',
  maxWidth = size === 'screen' ? 120 : 72,
  onClose,
  focused = true,
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
  const [forms, setForms] = useState(0);
  const registerForm = useCallback(() => {
    setForms((count) => count + 1);
    return () => setForms((count) => count - 1);
  }, []);
  const [host] = useState(createLayerHost);
  const outer = useLayout();
  const screen = size === 'screen';
  const overlay = outer.height !== undefined;
  const covered = nested > 0;
  // Only the top layer, the one in focus, shows its frame in accent, its `✕` and its keys.
  const top = focused && active && !covered;
  // A titled modal without hints still says how to close it. A Form inside adds its keys first, and
  // there `esc` cancels.
  const own = hints?.length ? hints : title ? [{ key: 'esc', description: 'close' }] : undefined;
  const footer =
    forms > 0 ? uniqueKeys([...FORM_KEYS, ...(own ?? []).filter((hint) => hint.key !== 'esc'), FORM_ESC]) : own;
  const { width, room, body } = modalSize(outer, { size, maxWidth, footer: footer !== undefined });
  // Kept stable, so content that reads the layout does not render again whenever a layer shows.
  const bodyLayout = useMemo(() => ({ width: body.width, height: body.height }), [body.width, body.height]);
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
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" paddingX={2} paddingY={1}>
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
            <LayerOutlet host={host} />
          </ModalLayerContext.Provider>
        </LayoutContext.Provider>
      </Box>
      {footer && (
        <Box
          paddingX={2}
          flexShrink={0}
          borderStyle="single"
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor={theme.border}
        >
          {/* The strip keeps its line under another layer, so the frame does not jump. */}
          {top ? <KeyHints hints={footer} width={width - 6} /> : <Text> </Text>}
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
    </Box>
  );
}
