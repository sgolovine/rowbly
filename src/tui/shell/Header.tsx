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
  const me = `me ${ctx?.me ?? '—'} `;
  const labelText = label ? `${label.title}${label.detail ? ` ${label.detail}` : ''}` : '';
  // The panel's border and padding, the gap after the label, and the label itself (it may be cut).
  const room = columns - 6 - Math.min(labelText.length, 30);
  const { showKeys, showMe, showExtras, showSettings, showSwitch } = headerFit(room, {
    me: me.length,
    extras: [...sidebars.map((s) => ({ label: s.label, key: '\\' })), ...actions],
    settings: onSettings !== undefined,
    viewSwitch: boardView !== undefined,
    newStory: onNewStory !== undefined,
  });
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
        {showMe && <Text color={theme.inkFaint}>{me}</Text>}
        {showExtras &&
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
        {showSettings && onSettings && (
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
        {showExtras &&
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
        {showSwitch && boardView && (
          <>
            <ViewSwitch view={boardView.view} onChange={boardView.onChange} clickable={clickable} />
            <Text color={theme.borderControl}>|</Text>
          </>
        )}
        {onNewStory && (
          <Button label="+ New Story" keyName="n" onClick={onNewStory} clickable={clickable} compact primary />
        )}
      </Box>
    </Panel>
  );
}

/** A header Button's width: its padding, label and key cap. */
const buttonWidth = (label: string, key?: string) => 2 + label.length + (key ? key.length + 3 : 0);
// The view switch: `Stages / List` and its key cap, with padding; a `|` follows every control.
const SWITCH_WIDTH = 19;

/**
 * Which header controls fit in `room` columns. The quiet Buttons' keys go first (they stay in Help),
 * then Me, the Plugin Buttons, Settings and the view switch; **+ New Story** and its key always stay.
 */
function headerFit(
  room: number,
  controls: {
    me: number;
    extras: readonly { label: string; key: string }[];
    settings: boolean;
    viewSwitch: boolean;
    newStory: boolean;
  },
) {
  const width = (fit: ReturnType<typeof level>) =>
    (fit.showMe ? controls.me : 0) +
    (fit.showExtras
      ? controls.extras.reduce((sum, c) => sum + buttonWidth(c.label, fit.showKeys ? c.key : undefined) + 1, 0)
      : 0) +
    (fit.showSettings && controls.settings ? buttonWidth('Settings', fit.showKeys ? ',' : undefined) + 1 : 0) +
    (fit.showSwitch && controls.viewSwitch ? SWITCH_WIDTH + 1 : 0) +
    (controls.newStory ? buttonWidth('+ New Story', 'n') : 0);
  const level = (n: number) => ({
    showKeys: n < 1,
    showMe: n < 2,
    showExtras: n < 3,
    showSettings: n < 4,
    showSwitch: n < 5,
  });
  for (let n = 0; n < 5; n += 1) if (width(level(n)) <= room) return level(n);
  return level(5);
}
