import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ConflictError } from '../../../core';
import { type Stage, type StageCategory, StageCategorySchema } from '../../../schemas';
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
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import type { ScreenProps, ScreenRegistry } from '../types';
import { type ConfigScope, LevelBar, type LevelName, levelsFor, targetFor, useConfigScope } from './shared';

type Mode =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; stage: Stage }
  | { kind: 'confirm-remove'; stage: Stage }
  | { kind: 'move-to'; stage: Stage; stories: number; tasks: number };

/** Stage management: order, Stage Category badges, add/edit/move/remove, and a level switcher. */
function StagesScreen({ params }: ScreenProps) {
  const scope = useConfigScope(params);
  if (!scope.data)
    return scope.loading ? <Loading label="Loading Stages…" /> : <Text color="red">No Stages to show.</Text>;
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
  const stages = list.data?.items ?? [];
  const listing = mode.kind === 'list';
  const [cursor, setCursor] = useCursor(stages.length, active && listing);
  const current = stages[cursor];

  useKeyCapture(active && !listing, { escape: true });
  useEscape(active && (mode.kind === 'add' || mode.kind === 'edit' || mode.kind === 'move-to'), () =>
    setMode({ kind: 'list' }),
  );
  useKeyHints(
    listing
      ? [
          { key: 'n', description: 'add' },
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
        moveTo
          ? `Removed ${stage.name}; moved ${moved.storiesMoved} Stories and ${moved.tasksMoved} Tasks to ${moveTo}`
          : `Removed ${stage.name}`,
      );
      setMode({ kind: 'list' });
      list.reload();
    } catch (err) {
      if (err instanceof ConflictError && typeof err.details.stories === 'number') {
        setMode({ kind: 'move-to', stage, stories: err.details.stories, tasks: Number(err.details.tasks ?? 0) });
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
      else if (!current) return;
      else if (input === 'e') setMode({ kind: 'edit', stage: current });
      else if (input === 'd') setMode({ kind: 'confirm-remove', stage: current });
      else if (up && cursor > 0) {
        void move(current, { before: stages[cursor - 1]?.key ?? '' }, cursor - 1);
      } else if (down && cursor < stages.length - 1) {
        void move(current, { after: stages[cursor + 1]?.key ?? '' }, cursor + 1);
      } else if (input === 'T' && cursor > 0) void move(current, 'first', 0);
      else if (input === 'B' && cursor < stages.length - 1) void move(current, 'last', stages.length - 1);
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
          active={active && listing}
          rows={stages.map((stage, i) => (
            <Text key={stage.key}>
              {`${i + 1}. `}
              <StageBadge stage={stage} /> <Text dimColor>{`${stage.key} · ${stage.category}`}</Text>
            </Text>
          ))}
        />
      )}
      {mode.kind === 'add' && (
        <Box flexDirection="column">
          <Text bold>Add a Stage</Text>
          <Form
            fields={[
              { name: 'key', label: 'Key', kind: 'text', required: true },
              { name: 'name', label: 'Name', kind: 'text', required: true },
              { name: 'category', label: 'Category', kind: 'select', options: StageCategorySchema.options },
              { name: 'position', label: 'Position', kind: 'select', options: positionOptions(current) },
            ]}
            initialValues={{ category: 'todo', position: positionOptions(current)[0] ?? 'last' }}
            onSubmit={async (values) => {
              const input = {
                key: String(values.key),
                name: String(values.name),
                category: values.category as StageCategory,
              };
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
            fields={[
              { name: 'name', label: 'Name', kind: 'text', required: true },
              { name: 'category', label: 'Category', kind: 'select', options: StageCategorySchema.options },
            ]}
            initialValues={{ name: mode.stage.name, category: mode.stage.category }}
            onSubmit={async (values) => {
              await services.stages.update(target, mode.stage.key, {
                name: String(values.name),
                category: values.category as StageCategory,
              });
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
          <Text>{`${mode.stage.name} is used by ${mode.stories} Stories and ${mode.tasks} Tasks. Move them to:`}</Text>
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

/** Position choices for a new Stage, relative to the highlighted one. */
function positionOptions(current: Stage | undefined): string[] {
  return current ? [`after ${current.key}`, `before ${current.key}`, 'first', 'last'] : ['last'];
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
