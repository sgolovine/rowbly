import { Box, type DOMElement, Text, useBoxMetrics } from 'ink';
import { type ReactNode, useRef } from 'react';
import { LayoutContext, useLayout } from '../hooks';
import type { KeyHint } from '../keymap';
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
  children: ReactNode;
}

/**
 * A framed panel centred over the area it is rendered in: the title in its border, the content, and a hint bar.
 * Without a fixed height (tests, piped output) there is nothing to cover, so it is shown below the
 * content instead, sized to fit.
 */
export function Modal({ title, hints, size = 'panel', maxWidth = 96, children }: ModalProps) {
  const outer = useLayout();
  const panel = size === 'panel';
  const width = Math.max(30, Math.min(maxWidth, outer.width - (panel ? 4 : 2)));
  const overlay = outer.height !== undefined;
  const room = overlay ? Math.max(8, (outer.height ?? 0) - 2) : undefined;
  // A titled modal without hints still says how to close it.
  const footer = hints?.length
    ? hints.map((hint) => `${hint.key} ${hint.description}`).join(' · ')
    : title
      ? 'esc close'
      : undefined;
  // Border (the title sits in it), hint bar with its rule, body padding.
  const chrome = 2 + (footer ? 2 : 0) + 2;
  const body = { width: width - 6, height: room === undefined ? undefined : room - chrome };
  // The modal fits its content, measured after the first layout, up to the room there is; longer
  // content is cut off at the bottom. (Yoga's `maxHeight` would squash the content instead.)
  const content = useRef<DOMElement>(null);
  const measured = useBoxMetrics(content);
  const height =
    room === undefined ? undefined : Math.min(room, measured.hasMeasured ? measured.height + chrome : room);

  const frame = (
    <Panel
      title={title}
      color="cyan"
      backgroundColor={overlay ? MODAL_BACKGROUND : undefined}
      width={panel ? width : undefined}
      maxWidth={width}
      height={height}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" paddingX={2} paddingY={1}>
        <Box ref={content} flexDirection="column" flexShrink={0}>
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
