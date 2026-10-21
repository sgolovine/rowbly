import { basename, dirname } from 'node:path';
import { Box, Text, useWindowSize } from 'ink';
import { useContext } from 'react';
import type { RowblyContext } from '../../services';
import { Button, Panel } from '../components';
import { type BoardView, type HeaderLabel, ServicesContext } from '../hooks';
import { theme } from '../theme';
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
  sidebars = [],
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
  /** A button per Plugin Sidebar, which shows or hides it; `\` steps through them. */
  sidebars?: readonly { id: string; label: string; toggle(): void }[];
}) {
  const { ctx } = useContext(ServicesContext);
  const { columns } = useWindowSize();
  const showKeys = columns >= 120;
  const showControls = columns >= 100;
  return (
    <Panel title={projectName(ctx)} height={3} paddingX={1} flexDirection="row" columnGap={2}>
      <Box flexGrow={1} flexShrink={1} minWidth={8}>
        {label && (
          <Text color={theme.ink} wrap="truncate-end">
            <Text bold>{label.title}</Text>
            {label.detail && <Text color={theme.inkMuted}> {label.detail}</Text>}
          </Text>
        )}
      </Box>
      <Box flexShrink={0} alignItems="center">
        {showControls && <Text color={theme.inkFaint}>me {ctx?.me ?? '—'} </Text>}
        {showControls &&
          sidebars.map((sidebar) => (
            <Box key={sidebar.id}>
              <Button
                label={sidebar.label}
                keyName={showKeys ? '\\' : undefined}
                onClick={sidebar.toggle}
                clickable={clickable}
                compact
              />
              <Text color={theme.borderControl}>|</Text>
            </Box>
          ))}
        {showControls && onSettings && (
          <>
            <Button
              label="Settings"
              keyName={showKeys ? ',' : undefined}
              onClick={onSettings}
              clickable={actionsClickable}
              compact
            />
            <Text color={theme.borderControl}>|</Text>
          </>
        )}
        {showControls &&
          actions.map((action) => (
            <Box key={action.key}>
              <Button
                label={action.label}
                keyName={showKeys ? action.key : undefined}
                onClick={action.run}
                clickable={actionsClickable}
                compact
              />
              <Text color={theme.borderControl}>|</Text>
            </Box>
          ))}
        {showControls && boardView && (
          <>
            <ViewSwitch view={boardView.view} onChange={boardView.onChange} clickable={clickable} />
            <Text color={theme.borderControl}>|</Text>
          </>
        )}
        {onNewStory && (
          <Button
            label="+ New Story"
            keyName={showKeys ? 'n' : undefined}
            onClick={onNewStory}
            clickable={clickable}
            compact
            primary
          />
        )}
      </Box>
    </Panel>
  );
}
