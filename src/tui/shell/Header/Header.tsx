import { Box, Text } from "ink";
import { Button, Panel } from "../../components/index.js";
import { useLayout } from "../../hooks/index.js";
import { theme } from "../../theme.js";
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

/**
 * The top of the shell: one Panel, three rows tall, with no title. The Project Button is at the far left,
 * and the Story finder follows it. The header Buttons are on the right: **Settings** (`,`), then the primary
 * **+ New Story**. The Panel never takes the focus, because it has no keys of its own.
 */
export function Header({
  project,
  finder,
  settings,
  newStory,
  clickable,
}: {
  project?: { name: string; onClick(): void };
  finder?: { onClick(): void };
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
  const compact = narrow || (project !== undefined && name.length + ROW_WIDTH_FULL > width);
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
