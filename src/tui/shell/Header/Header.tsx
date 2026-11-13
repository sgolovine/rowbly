import { Box, Text } from "ink";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { Button, Panel } from "../../components/index.js";
import { useLayout } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { FactoryButton, factoryButtonWidth } from "../FactoryButton/index.js";
import { StoryFinderButton } from "../StoryFinderButton/index.js";

/** Below this width, the Story finder shows only its glyph, and only the Buttons that always stay remain. */
const COMPACT_WIDTH = 60;

/** The most columns the Project name takes, when there is room. */
const PROJECT_NAME_WIDTH = 24;

/** The most columns the Project name takes below `COMPACT_WIDTH`. */
const PROJECT_NAME_NARROW_WIDTH = 12;

/** The columns of the row without the Project name, with the full and with the compact Story finder. */
const ROW_WIDTH_FULL = 73;
const ROW_WIDTH_COMPACT = 51;

/** The `|` after the Factory Button. */
const SEPARATOR_WIDTH = 1;

/**
 * The top of the shell: one Panel, three rows tall, with no title. The Project Button is at the far left,
 * and the Story finder follows it. The header Buttons are on the right: **Factory** (`f`), **Settings**
 * (`,`), then the primary **+ New Story**. The Panel never takes the focus, because it has no keys of its
 * own. When the row is too narrow, the Story finder becomes its glyph, then the Factory Button loses its
 * pending count and its key cap, then the Factory Button goes. Its key still works.
 */
export function Header({
  project,
  finder,
  factory,
  settings,
  newStory,
  clickable,
}: {
  project?: { name: string; onClick(): void };
  finder?: { onClick(): void };
  /** The status of the factory; `undefined` status means that the first read is not complete. */
  factory?: { status: FactoryStatus | undefined; onClick(): void };
  settings?: { onClick(): void };
  newStory?: {
    onClick(): void;
    /** Whether `n` makes a Story: not while the sidebar has the focus, where `n` makes a Stage. */
    showKey: boolean;
  };
  clickable: boolean;
}) {
  const { width } = useLayout();
  const narrow = width < COMPACT_WIDTH;
  const nameWidth = narrow ? PROJECT_NAME_NARROW_WIDTH : Math.min(PROJECT_NAME_WIDTH, width - ROW_WIDTH_COMPACT);
  const name =
    project && project.name.length > nameWidth ? `${project.name.slice(0, nameWidth - 1)}…` : (project?.name ?? "");
  const factoryWidth = (withKey: boolean, short = false) =>
    factory ? factoryButtonWidth(factory.status, withKey, short) + SEPARATOR_WIDTH : 0;
  const fits = (row: number) => project === undefined || name.length + row <= width;
  const compact = narrow || !fits(ROW_WIDTH_FULL + factoryWidth(true));
  // After the Story finder, the Factory Button loses its pending count, then its key cap, then it goes.
  const factoryShort = compact && !fits(ROW_WIDTH_COMPACT + factoryWidth(true));
  const factoryKey = fits((compact ? ROW_WIDTH_COMPACT : ROW_WIDTH_FULL) + factoryWidth(true, factoryShort));
  const factoryShown = factory !== undefined && !narrow && fits(ROW_WIDTH_COMPACT + factoryWidth(false, true));
  return (
    <Panel height={3} paddingX={1} flexDirection="row" columnGap={2}>
      {project && (
        <Box flexShrink={0}>
          <Button
            label={name}
            keyName={narrow ? undefined : "p"}
            onClick={project.onClick}
            clickable={clickable}
            compact
          />
          {finder && <Text color={theme.borderControl}>|</Text>}
        </Box>
      )}
      {finder && <StoryFinderButton compact={compact} clickable={clickable} onClick={finder.onClick} />}
      <Box flexGrow={1} flexShrink={1} />
      {/* More header Buttons go here, before the primary Button, each one followed by a `|`. */}
      <Box flexShrink={0}>
        {factory && factoryShown && (
          <>
            <FactoryButton
              status={factory.status}
              showKey={factoryKey}
              short={factoryShort}
              onClick={factory.onClick}
              clickable={clickable}
            />
            <Text color={theme.borderControl}>|</Text>
          </>
        )}
        {settings && !(narrow && project) && (
          <>
            <Button label="Settings" keyName="," onClick={settings.onClick} clickable={clickable} compact />
            {newStory && <Text color={theme.borderControl}>|</Text>}
          </>
        )}
        {newStory && (
          <Button
            label="+ New Story"
            keyName={newStory.showKey ? "n" : undefined}
            onClick={newStory.onClick}
            clickable={clickable}
            compact
            primary
          />
        )}
      </Box>
    </Panel>
  );
}
