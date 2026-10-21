import { Box } from 'ink';
import { type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { type Layout, LayoutContext, useLayout } from '../hooks';
import type { KeyHint } from '../keymap';
import { theme } from '../theme';
import { CloseButton } from './CloseButton';
import { KeyHints } from './KeyHints';
import { ModalLayerContext } from './modalLayer';
import { Panel } from './Panel';
import { ScrollBody } from './ScrollBody';

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
 * The size of a modal in `outer`: its width, the most lines it may take (`undefined` when it is not
 * shown over anything) and the room inside its body, for content that fills it.
 */
export function modalSize(
  outer: Layout,
  {
    size = 'panel',
    maxWidth = size === 'screen' ? 120 : 72,
    footer,
  }: { size?: ModalProps['size']; maxWidth?: number; footer: boolean },
): { width: number; room?: number; body: Layout } {
  const width = Math.max(30, Math.min(maxWidth, outer.width - 2));
  const room = outer.height === undefined ? undefined : Math.max(8, outer.height - 2);
  // Border (the title sits in it), hint bar with its rule, body padding.
  const chrome = 2 + (footer ? 2 : 0) + 2;
  return { width, room, body: { width: width - 6, height: room === undefined ? undefined : room - chrome } };
}

/**
 * A framed panel centred over the area it is rendered in: the title in its border, the content, and a hint bar.
 * Without a fixed height (tests, piped output) there is nothing to cover, so it is shown below the
 * content instead, sized to fit.
 */
export function Modal({
  title,
  hints,
  size = 'panel',
  maxWidth = size === 'screen' ? 120 : 72,
  onClose,
  focused = true,
  children,
}: ModalProps) {
  const parentLayer = useContext(ModalLayerContext);
  const [nested, setNested] = useState(0);
  const registerLayer = useCallback(() => {
    setNested((count) => count + 1);
    return () => setNested((count) => count - 1);
  }, []);
  useEffect(() => parentLayer?.(), [parentLayer]);
  const outer = useLayout();
  const screen = size === 'screen';
  const overlay = outer.height !== undefined;
  // A titled modal without hints still says how to close it.
  const footer = hints?.length ? hints : title ? [{ key: 'esc', description: 'close' }] : undefined;
  const { width, room, body } = modalSize(outer, { size, maxWidth, footer: footer !== undefined });
  const frame = (
    <Panel
      title={title}
      paddingX={0}
      aside={onClose && nested === 0 && <CloseButton onClick={onClose} />}
      focused={focused && nested === 0}
      backgroundColor={overlay ? MODAL_BACKGROUND : undefined}
      width={width}
      height={screen ? room : undefined}
      maxWidth={width}
      maxHeight={room}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" paddingX={2} paddingY={1}>
        <LayoutContext.Provider value={body}>
          <ModalLayerContext.Provider value={registerLayer}>
            {screen ? (
              children
            ) : (
              <ScrollBody active={nested === 0} height={body.height}>
                {children}
              </ScrollBody>
            )}
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
          <KeyHints hints={footer} />
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
