import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ConflictError, slugFromName } from '../../../core';
import { isFixedStage, type Stage, withFixedStages } from '../../../schemas';
import type { Position } from '../../../services';
import { readLevel } from '../../../services/_configTarget';
import { ConfirmDialog, CursorRows, Form, Loading, SelectList, StageBadge } from '../../components';
import {
  useAsync,
  useCursor,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useReloadOnReturn,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import { theme } from '../../theme';
import type { ScreenProps, ScreenRegistry } from '../types';
import { type ConfigScope, LevelBar, type LevelName, levelsFor, targetFor, useConfigScope } from './shared';

type Mode =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; stage: Stage }
  | { kind: 'confirm-remove'; stage: Stage }
  | { kind: 'move-to'; stage: Stage; reason: string };

/**
 * Stage management: order, Stage Category badges, add/edit/move/remove, and a level switcher. Backlog
 * and Done are shown but fixed (ADR-0024).
 */
function StagesScreen({ params }: ScreenProps) {
  const scope = useConfigScope(params);
  if (!scope.data)
    return scope.loading ? <Loading label="Loading Stages…" /> : <Text color={theme.danger}>No Stages to show.</Text>;
  return <StagesEditor scope={scope.data} />;
}

function StagesEditor({ scope }: { scope: ConfigScope }) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const active = useIsActive();
  const levels = levelsFor(scope);
  const [level, setLevel] = useState<LevelName>(levels[0] ?? 'global');
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const target = targetFor(scope, level);
  const list = useAsync(async () => (ctx ? readLevel(ctx, target, 'stages') : null), [ctx, level, scope]);
  useReloadOnReturn(list.reload);
  const stages = withFixedStages(list.data?.items ?? []);
  const listing = mode.kind === 'list';
  const [cursor, setCursor] = useCursor(stages.length, active && listing);
  const current = stages[cursor];
  // Configured Stages sit between Backlog (first) and Done (last).
  const firstConfigured = 1;
  const lastConfigured = stages.length - 2;

  useKeyCapture(active && !listing, { escape: true });
  useEscape(active && (mode.kind === 'add' || mode.kind === 'edit' || mode.kind === 'move-to'), () =>
    setMode({ kind: 'list' }),
  );
  useKeyHints(
    listing
      ? [
          { key: 'n', description: 'new Stage' },
          { key: 'e', description: 'edit' },
          { key: 'shift+↑/↓', description: 'move up/down' },
          { key: 'T/B', description: 'move first/last' },
          { key: 'd', description: 'remove' },
          { key: 'l', description: 'switch level' },
          { key: 'K/J', description: 'move up/down (vim keys)', secondary: true },
        ]
      : [{ key: 'esc', description: 'cancel' }],
  );

  const move = async (stage: Stage, position: Position, to: number) => {
    try {
      await services.stages.move(target, stage.key, position);
      setCursor(to);
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async (stage: Stage, moveTo?: string) => {
    try {
      const moved = await services.stages.remove(target, stage.key, { moveTo });
      toast.push(
        'info',
        moveTo ? `Removed ${stage.name}; moved ${moved.storiesMoved} Stories to ${moveTo}` : `Removed ${stage.name}`,
      );
      setMode({ kind: 'list' });
      list.reload();
    } catch (err) {
      // Core and Plugins mark a Stage still in use with `needsMoveTo`, so the person can pick where to.
      if (err instanceof ConflictError && err.details.needsMoveTo === true) {
        setMode({ kind: 'move-to', stage, reason: err.message });
      } else {
        toast.error(err);
        setMode({ kind: 'list' });
      }
    }
  };

  useInput(
    (input, key) => {
      const up = input === 'K' || (key.shift && key.upArrow);
      const down = input === 'J' || (key.shift && key.downArrow);
      if (input === 'l') {
        setLevel(levels[(levels.indexOf(level) + 1) % levels.length] ?? level);
        setCursor(0);
      } else if (input === 'n') setMode({ kind: 'add' });
      else if (!current || isFixedStage(current.key)) return;
      else if (input === 'e') setMode({ kind: 'edit', stage: current });
      else if (input === 'd') setMode({ kind: 'confirm-remove', stage: current });
      else if (up && cursor > firstConfigured) {
        void move(current, { before: stages[cursor - 1]?.key ?? '' }, cursor - 1);
      } else if (down && cursor < lastConfigured) {
        void move(current, { after: stages[cursor + 1]?.key ?? '' }, cursor + 1);
      } else if (input === 'T' && cursor > firstConfigured) void move(current, 'first', firstConfigured);
      else if (input === 'B' && cursor < lastConfigured) void move(current, 'last', lastConfigured);
    },
    { isActive: active && listing && !list.loading },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <LevelBar levels={levels} level={level} source={list.data?.source} />
      {list.loading && !list.data ? (
        <Loading label="Loading Stages…" />
      ) : (
        <CursorRows
          cursor={cursor}
          rows={stages.map((stage, i) => (
            <Text key={stage.key}>
              {`${i + 1}. `}
              <StageBadge stage={stage} />{' '}
              <Text
                color={theme.inkFaint}
              >{`${stage.key} · ${stage.category}${isFixedStage(stage.key) ? ' · fixed' : ''}`}</Text>
            </Text>
          ))}
        />
      )}
      {mode.kind === 'add' && (
        <Box flexDirection="column">
          <Text bold>Add a Stage</Text>
          <Form
            fields={[
              { name: 'name', label: 'Name', kind: 'text', required: true },
              {
                name: 'key',
                label: 'Key',
                kind: 'text',
                required: true,
                fillFrom: { field: 'name', format: (name) => slugFromName(name, new Set(stages.map((s) => s.key))) },
              },
              { name: 'position', label: 'Position', kind: 'select', options: positionOptions(current) },
            ]}
            initialValues={{ position: positionOptions(current)[0] ?? 'last' }}
            onSubmit={async (values) => {
              const input = { key: String(values.key), name: String(values.name) };
              await services.stages.add(target, input, parsePosition(String(values.position)));
              toast.push('info', `Added ${input.name}`);
              setMode({ kind: 'list' });
              list.reload();
            }}
          />
        </Box>
      )}
      {mode.kind === 'edit' && (
        <Box flexDirection="column">
          <Text bold>Edit {mode.stage.key}</Text>
          <Form
            fields={[{ name: 'name', label: 'Name', kind: 'text', required: true }]}
            initialValues={{ name: mode.stage.name }}
            onSubmit={async (values) => {
              await services.stages.update(target, mode.stage.key, { name: String(values.name) });
              toast.push('info', `Updated ${mode.stage.key}`);
              setMode({ kind: 'list' });
              list.reload();
            }}
          />
        </Box>
      )}
      {mode.kind === 'confirm-remove' && (
        <ConfirmDialog
          message={`Remove Stage ${mode.stage.name} at the ${level} level?`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void remove(mode.stage)}
          onCancel={() => setMode({ kind: 'list' })}
        />
      )}
      {mode.kind === 'move-to' && (
        <Box flexDirection="column">
          <Text>{`${mode.reason}. Move them to:`}</Text>
          <SelectList
            items={stages
              .filter((s) => s.key !== mode.stage.key)
              .map((s) => ({ value: s.key, label: s.name, description: s.key }))}
            onSelect={(item) => void remove(mode.stage, item.value)}
          />
        </Box>
      )}
    </Box>
  );
}

/** Position choices for a new Stage, relative to the highlighted one; nothing goes before Backlog or after Done. */
function positionOptions(current: Stage | undefined): string[] {
  if (!current || current.category === 'done') return ['last', 'first'];
  if (current.category === 'backlog') return ['first', 'last'];
  return [`after ${current.key}`, `before ${current.key}`, 'first', 'last'];
}

function parsePosition(option: string): Position {
  if (option.startsWith('after ')) return { after: option.slice('after '.length) };
  if (option.startsWith('before ')) return { before: option.slice('before '.length) };
  return option === 'first' ? 'first' : 'last';
}

export { type ConfigScope, LevelBar, type LevelName, levelsFor, targetFor, useConfigScope } from './shared';

export const stagesScreens: ScreenRegistry = {
  stages: StagesScreen,
};
