import { basename, dirname } from 'node:path';
import { Box, Text } from 'ink';
import { useContext } from 'react';
import type { RowblyContext } from '../../services';
import { Button, Panel } from '../components';
import { type BoardView, type HeaderLabel, ServicesContext } from '../hooks';
import { ViewSwitch } from './ViewSwitch';

/** The project the Data Root belongs to: the folder holding `.rowbly`, or "Global" for `~/.rowbly`. */
export function projectName(ctx: RowblyContext | null): string {
  if (!ctx) return 'Rowbly';
  if (ctx.root.kind === 'global') return 'Global';
  return basename(dirname(ctx.root.path)) || 'Rowbly';
}

/** A Plugin Action in focus, shown as a header button (ADR-0017). */
export interface HeaderAction {
  key: string;
  label: string;
  run(): void;
}

export function Header({
  label,
  onNewStory,
  onSettings,
  clickable,
  actions = [],
  actionsClickable = clickable,
  boardView,
}: {
  label: HeaderLabel | null;
  onNewStory?: () => void;
  /** Opens the settings, like `,`. */
  onSettings?: () => void;
  clickable: boolean;
  /** The board view switch, shown while the board is the root screen. */
  boardView?: { view: BoardView; onChange(view: BoardView): void };
  actions?: readonly HeaderAction[];
  /** Actions act on the screen in focus, which may be in a modal. */
  actionsClickable?: boolean;
}) {
  const { ctx } = useContext(ServicesContext);
  // The button sits beside the panel rather than inside it, so the header stays three lines tall.
  return (
    <Box flexShrink={0}>
      <Panel title={projectName(ctx)} flexGrow={1} flexShrink={1} paddingX={1} flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1}>
          {label && (
            <Text wrap="truncate-end">
              <Text bold>{label.title}</Text>
              {label.detail && <Text dimColor>{` ${label.detail}`}</Text>}
            </Text>
          )}
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>me: {ctx?.me ?? '—'}</Text>
        </Box>
      </Panel>
      {onSettings && <Button label="Settings" keyName="," onClick={onSettings} clickable={actionsClickable} compact />}
      {actions.map((action) => (
        <Button
          key={action.key}
          label={action.label}
          keyName={action.key}
          onClick={action.run}
          clickable={actionsClickable}
          compact
        />
      ))}
      {boardView && <ViewSwitch view={boardView.view} onChange={boardView.onChange} clickable={clickable} />}
      {onNewStory && <Button label="+ New Story" onClick={onNewStory} clickable={clickable} compact />}
    </Box>
  );
}
