import { Box, markdownToPlain, Text, useInput, useIsActive, useLayout, useState } from '../../plugin-api/tui';

/** Keeps every part of a long Spec reachable in the terminal viewport. */
export function SpecText({
  text,
  active = true,
  reservedRows = 0,
}: {
  text: string;
  active?: boolean;
  reservedRows?: number;
}) {
  const layout = useLayout();
  const isActive = useIsActive() && active;
  const [offset, setOffset] = useState(0);
  const width = Math.max(1, layout.width);
  const lines = markdownToPlain(text)
    .split('\n')
    .flatMap((line) => {
      const chars = Array.from(line);
      const wrapped: string[] = [];
      for (let i = 0; i < chars.length; i += width) wrapped.push(chars.slice(i, i + width).join(''));
      return wrapped.length ? wrapped : [''];
    });
  const height = layout.height === undefined ? lines.length : Math.max(1, layout.height - reservedRows - 1);
  const max = Math.max(0, lines.length - height);
  const start = Math.min(offset, max);
  useInput(
    (input, key) => {
      const delta = key.downArrow || input === 'j' ? 1 : key.upArrow || input === 'k' ? -1 : 0;
      if (delta) setOffset(Math.max(0, Math.min(max, start + delta)));
    },
    { isActive },
  );
  return (
    <Box flexDirection="column">
      <Text>{lines.slice(start, start + height).join('\n')}</Text>
      {max > 0 && (
        <Text dimColor>{`${start + 1}–${Math.min(lines.length, start + height)} of ${lines.length} · ↑/↓ scroll`}</Text>
      )}
    </Box>
  );
}
