import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { theme } from '../theme';

export interface DetailRow {
  label: string;
  value: ReactNode;
}

export interface DetailViewProps {
  rows: readonly DetailRow[];
  /** Markdown, shown as plain text. */
  body?: string;
}

/** Key/value rows with an optional markdown body underneath. */
export function DetailView({ rows, body }: DetailViewProps) {
  const width = Math.max(0, ...rows.map((row) => row.label.length)) + 2;
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.label}>
          <Box width={width} flexShrink={0}>
            <Text color={theme.inkFaint}>{row.label}</Text>
          </Box>
          {typeof row.value === 'string' || typeof row.value === 'number' ? <Text>{row.value}</Text> : row.value}
        </Box>
      ))}
      {body?.trim() && (
        <Box marginTop={rows.length > 0 ? 1 : 0}>
          <Text>{markdownToPlain(body)}</Text>
        </Box>
      )}
    </Box>
  );
}

/** Drops markdown syntax that reads badly in a terminal: heading marks, emphasis, code ticks, link targets. */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^(\s*)[*+-]\s+/gm, '$1• ')
    .trimEnd();
}
