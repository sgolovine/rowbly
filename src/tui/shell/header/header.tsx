import { Box, Text } from "ink";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { Button, Panel } from "../../components/index.js";
import { useLayout } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { FactoryButton } from "../factory-button/index.js";
import { StoryFinderButton } from "../story-finder-button/index.js";
import { ViewModeSwitch } from "../view-mode-switch/index.js";
import { headerFit } from "./header-fit.js";

/**
 * The top of the shell: one Panel, three rows tall, with no title. The Project Button is at the far left,
 * and the Story finder follows it. The header Buttons are on the right: **Factory** (`f`), **Settings**
 * (`,`), then the primary **+ New Story**. The view mode switch (`t`) follows the Factory Button in the same
 * group: `Stories` shows the Story list, and `Threads` shows the Factory view. The Panel never takes the focus,
 * because it has no keys of its own. When the row is too narrow, the switch goes first. Then the Story finder
 * becomes its glyph, the Factory Button loses its pending count and its key cap, then the Factory Button goes.
 * Their keys still work.
 */
export function Header({
  project,
  finder,
  factory,
  viewSwitch,
  settings,
  newStory,
  clickable,
}: {
  project?: { name: string; onClick(): void };
  finder?: { onClick(): void };
  /** The status of the factory; `undefined` status means that the first read is not complete. */
  factory?: { status: FactoryStatus | undefined; onClick(): void };
  /** The view mode: `threads` shows the Factory view. A click on the switch calls `onToggle`. */
  viewSwitch?: { threads: boolean; onToggle(): void };
  settings?: { onClick(): void };
  newStory?: {
    onClick(): void;
    /** Whether `n` makes a Story: not while the sidebar has the focus, where `n` makes a Stage. */
    showKey: boolean;
  };
  clickable: boolean;
}) {
  const { width } = useLayout();
  const { narrow, name, compact, factoryShort, factoryKey, factoryShown, switchShown } = headerFit({
    width,
    project: project?.name,
    factory,
    viewSwitch: viewSwitch !== undefined,
  });

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
            {viewSwitch && switchShown && (
              <ViewModeSwitch
                threads={viewSwitch.threads}
                showKey={factoryKey}
                onToggle={viewSwitch.onToggle}
                clickable={clickable}
              />
            )}
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
