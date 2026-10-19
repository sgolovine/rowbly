import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { type Layout, LayoutContext, useLayout } from '../hooks';
import type { KeyHint } from '../keymap';
import { CloseButton } from './CloseButton';
import { Panel } from './Panel';

/** Filled behind the modal so the screen below does not show through. */
export const MODAL_BACKGROUND = '#202028';

export interface ModalProps {
  title?: string;
  /** Shown along the bottom edge, e.g. the keys of the screen inside. */
  hints?: readonly KeyHint[];
  /**
   * `panel` (the default) takes most of the area for a screen or a form; `dialog` sizes itself to
   * its content, for confirmations and pickers.
   */
  size?: 'panel' | 'dialog';
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
  { size = 'panel', maxWidth = 96, footer }: { size?: ModalProps['size']; maxWidth?: number; footer: boolean },
): { width: number; room?: number; body: Layout } {
  const width = Math.max(30, Math.min(maxWidth, outer.width - (size === 'panel' ? 4 : 2)));
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
export function Modal({ title, hints, size = 'panel', maxWidth = 96, onClose, children }: ModalProps) {
  const outer = useLayout();
  const panel = size === 'panel';
  const overlay = outer.height !== undefined;
  // A titled modal without hints still says how to close it.
  const footer = hints?.length
    ? hints.map((hint) => `${hint.key} ${hint.description}`).join(' · ')
    : title
      ? 'esc close'
      : undefined;
  const { width, room, body } = modalSize(outer, { size, maxWidth, footer: footer !== undefined });
  const frame = (
    <Panel
      title={title}
      aside={onClose && <CloseButton onClick={onClose} />}
      color="cyan"
      backgroundColor={overlay ? MODAL_BACKGROUND : undefined}
      width={panel ? width : undefined}
      maxWidth={width}
      maxHeight={room}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" paddingX={2} paddingY={1}>
        {/* Keep content at its natural height; only the viewport shrinks when the panel is capped. */}
        <Box flexDirection="column" flexShrink={0}>
          <LayoutContext.Provider value={body}>{children}</LayoutContext.Provider>
        </Box>
      </Box>
      {footer && (
        <Box
          paddingX={2}
          flexShrink={0}
          borderStyle="single"
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor="cyan"
          borderDimColor
        >
          <Text dimColor wrap="truncate-end">
            {footer}
          </Text>
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
