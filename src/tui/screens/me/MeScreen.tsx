import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { useState } from 'react';
import { identity } from '../../../services';
import { SelectList } from '../../components';
import { useEscape, useKeyHints, useRowblyContext } from '../../hooks';
import { theme } from '../../theme';
import { type MeLevel, MeLevelForm } from './MeLevelForm';

/**
 * Me at its two levels (`whoami`, ADR-0032): global Me in `~/.rowblyrc.json`, and this Data Root's
 * local Me in `local.json`, which replaces global Me here. `enter` edits the highlighted level.
 */
export function MeScreen() {
  const ctx = useRowblyContext();
  const [editing, setEditing] = useState<MeLevel | null>(null);
  useEscape(editing !== null, () => setEditing(null));
  useKeyHints(editing ? [] : [{ key: 'enter', description: 'edit' }]);
  if (!ctx) return null;
  const home = ctx.home ?? homedir();
  const { me, source, global, local } = identity(ctx.local, ctx.globalMe ?? null);
  const value = (handle: string | null) => handle ?? '—';
  const from = source === 'local' ? '(local Me)' : source === 'global' ? '(global Me)' : '';
  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        Me: {me ? <Text bold>{me}</Text> : <Text color={theme.inkFaint}>not set</Text>}{' '}
        <Text color={theme.inkFaint}>{from}</Text>
      </Text>
      <Text color={theme.inkFaint}>
        The handle you work as: the creator of your Stories and the author of your Comments. A local Me replaces global
        Me in this Data Root; clear it to use global Me here.
      </Text>
      <SelectList<MeLevel>
        isActive={editing === null}
        items={[
          { value: 'global', label: `Global  ${value(global)}`, description: '~/.rowblyrc.json · every Data Root' },
          {
            value: 'local',
            label: `This Data Root  ${value(local)}`,
            description: 'local.json · never committed',
          },
        ]}
        onSelect={(item) => setEditing(item.value)}
      />
      {editing && (
        <MeLevelForm
          level={editing}
          handle={editing === 'global' ? global : local}
          home={home}
          onDone={() => setEditing(null)}
        />
      )}
    </Box>
  );
}
