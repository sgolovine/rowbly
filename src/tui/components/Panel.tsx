import { Box, type BoxProps, type DOMElement, Text } from 'ink';
import { type ReactNode, useRef } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';

export interface PanelProps extends Omit<BoxProps, 'borderStyle' | 'borderTop' | 'borderColor' | 'borderDimColor'> {
  /** Set into the top edge of the border, lazygit style: `╭─Title────╮`. */
  title?: string;
  /** Set into the right of the top edge, after the rule, e.g. a close button. */
  aside?: ReactNode;
  /** Whether the panel owns focus; all other frames stay quiet. */
  focused?: boolean;
  /** A click anywhere in the panel that no smaller box inside it takes, such as one that focuses it. */
  onClick?: () => void;
  children?: ReactNode;
}

/**
 * A box framed by a rounded border with its title in the top edge. Ink draws no titles, so the top
 * edge is a row of its own and the box below it is bordered on the other three sides.
 */
export function Panel({
  title,
  aside,
  focused = false,
  onClick,
  children,
  flexDirection = 'column',
  ...box
}: PanelProps) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, onClick !== undefined);
  const color = focused ? theme.accent : theme.border;
  return (
    <Box ref={ref} flexDirection="column" flexShrink={0} {...pick(box)}>
      <Box height={1} flexShrink={0}>
        <Text color={color}>╭─</Text>
        {title && (
          <Box flexShrink={1} overflow="hidden">
            <Text color={focused ? theme.accent : theme.inkMuted} bold={focused} wrap="truncate-end">
              {title.split(' › ').map((crumb, i, crumbs) => (
                <Text
                  // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb identity is its stack position, and names can repeat.
                  key={`${i}:${crumb}`}
                  bold={focused && i === crumbs.length - 1}
                  color={focused && i === crumbs.length - 1 ? theme.accent : theme.inkMuted}
                >
                  {i > 0 ? ' › ' : ''}
                  {crumb}
                </Text>
              ))}
            </Text>
          </Box>
        )}
        {/* A long rule cut to the room left; a hard-wrapped Text clipped to one line. */}
        <Box flexGrow={1} flexBasis={0} height={1} overflow="hidden">
          <Text color={color}>{'─'.repeat(400)}</Text>
        </Box>
        {aside}
        <Text color={color}>╮</Text>
      </Box>
      <Box
        flexDirection={flexDirection}
        flexGrow={1}
        flexShrink={1}
        borderStyle="round"
        borderTop={false}
        borderColor={color}
        paddingX={1}
        {...inner(box)}
      >
        {children}
      </Box>
    </Box>
  );
}

// Size and placement go on the whole panel; everything else (padding, gaps, overflow) on its inside.
// A background fills both.
const OUTER = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'flexGrow',
  'flexShrink',
  'flexBasis',
]);

function pick(box: BoxProps): BoxProps {
  return Object.fromEntries(
    Object.entries(box).filter(([key]) => OUTER.has(key) || key === 'backgroundColor'),
  ) as BoxProps;
}

function inner(box: BoxProps): BoxProps {
  return Object.fromEntries(Object.entries(box).filter(([key]) => !OUTER.has(key))) as BoxProps;
}
