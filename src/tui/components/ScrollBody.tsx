import { Box, type DOMElement, measureElement, Text, useInput } from 'ink';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useIsActive } from '../hooks';
import { theme } from '../theme';
import { ScrollFocusContext } from './scrollFocus';

/** A bounded viewport; Page Up/Down scroll without taking a screen's selection keys. */
export function ScrollBody({ children, height }: { children: ReactNode; height?: number }) {
  const active = useIsActive();
  const ref = useRef<DOMElement>(null);
  const viewport = useRef<DOMElement>(null);
  const [lines, setLines] = useState(0);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setLines(measureElement(ref.current).height);
  });
  const room = height === undefined ? undefined : Math.max(1, height - (lines > height ? 1 : 0));
  const max = room === undefined ? 0 : Math.max(0, lines - room);
  const start = Math.min(offset, max);
  useInput(
    (_input, key) => {
      if (key.pageDown || key.pageUp)
        setOffset(Math.max(0, Math.min(max, start + (key.pageUp ? -1 : 1) * (room ?? 1))));
    },
    { isActive: active && max > 0 },
  );
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      <Box
        ref={viewport}
        flexDirection="column"
        height={room === undefined ? undefined : Math.min(room, Math.max(1, lines))}
        overflow="hidden"
        flexShrink={1}
      >
        <Box ref={ref} flexDirection="column" flexShrink={0} marginTop={-start}>
          <ScrollFocusContext.Provider
            value={(node) => {
              if (!viewport.current || room === undefined) return;
              const target = measureElement(node);
              const view = measureElement(viewport.current);
              const delta =
                target.y < view.y
                  ? target.y - view.y
                  : target.y + target.height > view.y + room
                    ? target.y + target.height - view.y - room
                    : 0;
              if (delta) setOffset((current) => Math.max(0, Math.min(max, current + delta)));
            }}
          >
            {children}
          </ScrollFocusContext.Provider>
        </Box>
      </Box>
      {max > 0 && (
        <Text color={theme.inkFaint}>
          ↑↓ {start + 1}–{Math.min(lines, start + (room ?? 1))} of {lines} · pgup/pgdn scroll
        </Text>
      )}
    </Box>
  );
}
