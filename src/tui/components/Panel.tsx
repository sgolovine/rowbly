import { Box, type BoxProps, Text } from 'ink';
import type { ReactNode } from 'react';

export interface PanelProps extends Omit<BoxProps, 'borderStyle' | 'borderTop' | 'borderColor' | 'borderDimColor'> {
  /** Set into the top edge of the border, lazygit style: `╭─Title────╮`. */
  title?: string;
  /** Border and title colour; a panel without one has a dim border. */
  color?: string;
  children?: ReactNode;
}

/**
 * A box framed by a rounded border with its title in the top edge. Ink draws no titles, so the top
 * edge is a row of its own and the box below it is bordered on the other three sides.
 */
export function Panel({ title, color, children, flexDirection = 'column', ...box }: PanelProps) {
  const dim = color === undefined;
  return (
    <Box flexDirection="column" flexShrink={0} {...pick(box)}>
      <Box height={1} flexShrink={0}>
        <Text color={color} dimColor={dim}>
          ╭─
        </Text>
        {title && (
          <Box flexShrink={1} overflow="hidden">
            <Text color={color ?? 'cyan'} bold={!dim} wrap="truncate-end">
              {title}
            </Text>
          </Box>
        )}
        {/* A long rule cut to the room left; a hard-wrapped Text clipped to one line. */}
        <Box flexGrow={1} flexBasis={0} height={1} overflow="hidden">
          <Text color={color} dimColor={dim}>
            {'─'.repeat(400)}
          </Text>
        </Box>
        <Text color={color} dimColor={dim}>
          ╮
        </Text>
      </Box>
      <Box
        flexDirection={flexDirection}
        flexGrow={1}
        flexShrink={1}
        borderStyle="round"
        borderTop={false}
        borderColor={color}
        borderDimColor={dim}
        {...inner(box)}
      >
        {children}
      </Box>
    </Box>
  );
}

// Size and placement go on the whole panel; everything else (padding, gaps, overflow) on its inside.
// A background fills both.
const OUTER = new Set(['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'flexGrow', 'flexShrink', 'flexBasis']);

function pick(box: BoxProps): BoxProps {
  return Object.fromEntries(
    Object.entries(box).filter(([key]) => OUTER.has(key) || key === 'backgroundColor'),
  ) as BoxProps;
}

function inner(box: BoxProps): BoxProps {
  return Object.fromEntries(Object.entries(box).filter(([key]) => !OUTER.has(key))) as BoxProps;
}
