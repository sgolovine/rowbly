import { Box, Text, useWindowSize } from 'ink';
import { useContext } from 'react';
import { Button, Panel } from '../components';
import { type BoardView, type HeaderLabel, ServicesContext } from '../hooks';
import { theme } from '../theme';
import { ViewSwitch } from './ViewSwitch';

/** The longest Data Root name the header shows; a longer one is cut with `…`. */
const ROOT_NAME_MAX = 24;

/** A Plugin Action in focus, shown as a header button (ADR-0017). */
export interface HeaderAction {
  key: string;
  label: string;
  busy: boolean;
  run(): void;
}

export function Header({
  root,
  label,
  onNewStory,
  newStoryKey = true,
  onSettings,
  clickable,
  actions = [],
  actionsClickable = clickable,
  boardView,
  sidebars = [],
}: {
  /** The far-left Button naming the Data Root that is open; it opens the Data Root switcher, like `D`. */
  root: { name: string; onClick(): void; clickable: boolean };
  label: HeaderLabel | null;
  onNewStory?: () => void;
  /** Whether `n` makes a new Story: not while a sidebar has focus, where it creates there. */
  newStoryKey?: boolean;
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
  // The Data Root Button names what is open, so the header shows only the label's detail, not its title.
  const labelText = label?.detail ?? '';
  const rootName = root.name.length > ROOT_NAME_MAX ? `${root.name.slice(0, ROOT_NAME_MAX - 1)}…` : root.name;
  // The panel's border and padding, the gap after the label, the label itself (it may be cut) and the
  // Data Root Button with its `|`, whose key goes with the other Buttons' keys.
  const room = columns - 6 - Math.min(labelText.length, 30) - buttonWidth(rootName) - 3;
  const { showKeys, showMe, showExtras, showSettings, showSwitch } = headerFit(room, {
    me: me.length,
    extras: [...sidebars.map((s) => ({ label: s.label, key: '\\' })), ...actions],
    settings: onSettings !== undefined,
    viewSwitch: boardView !== undefined,
    newStory: onNewStory !== undefined,
    rootKey: buttonWidth('', 'D') - buttonWidth(''),
  });
  const progress = actions
    .filter((action) => action.busy)
    .map((action) => action.label)
    .join(' · ');
  const detail = !showExtras && progress ? progress : labelText;
  return (
    <Panel height={3} paddingX={1} flexDirection="row" columnGap={2}>
      <Box flexShrink={0}>
        <Button
          label={rootName}
          keyName={showKeys ? 'D' : undefined}
          onClick={root.onClick}
          clickable={root.clickable}
          compact
        />
        <Text color={theme.borderControl}>|</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={8}>
        {detail && (
          <Text color={theme.inkMuted} wrap="truncate-end">
            {detail}
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
                keyName={showKeys && !action.busy ? action.key : undefined}
                onClick={action.run}
                clickable={actionsClickable && !action.busy}
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
          <Button
            label="+ New Story"
            keyName={newStoryKey ? 'n' : undefined}
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

/** A header Button's width: its padding, label and key cap. */
const buttonWidth = (label: string, key?: string) => 2 + label.length + (key ? key.length + 3 : 0);
// The view switch: `Stages / List` and its key cap, with padding; a `|` follows every control.
const SWITCH_WIDTH = 19;

/**
 * Which header controls fit in `room` columns. The quiet Buttons' keys go first (they stay in Help),
 * then Me, the Plugin Buttons, Settings and the view switch; **+ New Story** and its key, and the Data Root
 * Button, always stay.
 */
function headerFit(
  room: number,
  controls: {
    me: number;
    extras: readonly { label: string; key: string }[];
    settings: boolean;
    viewSwitch: boolean;
    newStory: boolean;
    /** The Data Root Button's key cap, shown with the other keys. */
    rootKey: number;
  },
) {
  const width = (fit: ReturnType<typeof level>) =>
    (fit.showMe ? controls.me : 0) +
    (fit.showExtras
      ? controls.extras.reduce((sum, c) => sum + buttonWidth(c.label, fit.showKeys ? c.key : undefined) + 1, 0)
      : 0) +
    (fit.showSettings && controls.settings ? buttonWidth('Settings', fit.showKeys ? ',' : undefined) + 1 : 0) +
    (fit.showSwitch && controls.viewSwitch ? SWITCH_WIDTH + 1 : 0) +
    (controls.newStory ? buttonWidth('+ New Story', 'n') : 0) +
    (fit.showKeys ? controls.rootKey : 0);
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
