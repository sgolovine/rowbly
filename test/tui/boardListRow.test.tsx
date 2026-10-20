import { stripVTControlCharacters } from 'node:util';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import type { Story } from '../../src/schemas';
import { BoardListRow } from '../../src/tui/screens/board/BoardListRow';

const story: Story = {
  version: 1,
  key: 'WEB-1',
  boardId: 'web',
  name: 'Login page with a long name',
  description: '',
  stage: 'doing',
  rank: 'a0',
  priority: null,
  labels: [],
  dueDate: null,
  customFields: {},
  createdBy: null,
  createdAt: '2026-10-19T00:00:00.000Z',
  updatedAt: '2026-10-19T00:00:00.000Z',
};

function renderRow(width: number, badges: readonly string[]) {
  return stripVTControlCharacters(
    renderToString(
      <BoardListRow
        row={{ kind: 'story', story, stage: { key: 'doing', name: 'In Progress', category: 'board' } }}
        badges={badges}
        width={width}
        selected
        active
        onClick={() => {}}
      />,
      { columns: width },
    ),
  ).split('\n');
}

describe('BoardListRow', () => {
  it.each([56, 60, 80])('keeps long badges inside a two-line row at width %i', (width) => {
    const badges = ['@alexandra', '@benjamin', '@christina', '@daniella', '✓ 3/10'];
    const lines = renderRow(width, badges);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^ {2}› WEB-1 /);
    expect(lines[0]).toContain('@alexandra');
    expect(lines[0]).toContain('…');
    expect(lines[0]).toContain('● In Progress');
    expect(lines.every((line) => line.length <= width)).toBe(true);
    expect(lines[1]).toBe('─'.repeat(width));
  });

  it('shows short badges in full and keeps rows without badges compact', () => {
    const [line] = renderRow(80, ['@sam', '✓ 1/2']);
    expect(line).toMatch(/WEB-1 Login page with a long name +@sam · ✓ 1\/2 +● In Progress/);
    const empty = renderRow(56, []);
    expect(empty).toHaveLength(2);
    expect(empty[0]).toMatch(/^ {2}› WEB-1 /);
    expect(empty[0]).toContain('● In Progress');
    expect(empty.every((row) => row.length <= 56)).toBe(true);
  });
});
