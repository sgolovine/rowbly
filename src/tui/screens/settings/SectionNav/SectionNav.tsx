import { Box, Text } from "ink";
import { PANEL_FRAME_HEIGHT, Panel, ScrollBody, SelectionRow } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import type { SettingsGroup } from "../settingsSections.js";

/** The width of the section list of Settings, with its frame. */
export const SECTION_NAV_WIDTH = 22;

/**
 * The section list of Settings, in a Panel: a heading for each group, with a blank row between the
 * groups. The selected section keeps its bar and its fill, also when the section has the focus. A click
 * on a section opens it.
 */
export function SectionNav({
  groups,
  selected,
  clickable,
  focused,
  height,
  onFocus,
  onSelect,
}: {
  groups: readonly SettingsGroup[];
  /** The `id` of the selected section. */
  selected: string;
  clickable: boolean;
  /** Whether the list has the focus. */
  focused?: boolean;
  height?: number;
  /** A click in the list that no section takes. */
  onFocus?: () => void;
  onSelect(id: string): void;
}) {
  return (
    <Panel focused={focused} onClick={onFocus} flexShrink={0} width={SECTION_NAV_WIDTH} height={height}>
      <ScrollBody
        height={height === undefined ? undefined : Math.max(1, height - PANEL_FRAME_HEIGHT)}
        active={clickable}
      >
        <Box flexDirection="column" gap={1}>
          {groups.map((group) => (
            <Box key={group.title} flexDirection="column" flexShrink={0}>
              <Text color={theme.inkFaint} wrap="truncate-end">
                {group.title}
              </Text>
              {group.sections.map((section) => (
                <SelectionRow
                  key={section.id}
                  selected={section.id === selected}
                  active={clickable}
                  onClick={() => onSelect(section.id)}
                >
                  <Text color={theme.ink} bold={section.id === selected} wrap="truncate-end">
                    {section.label}
                  </Text>
                </SelectionRow>
              ))}
            </Box>
          ))}
        </Box>
      </ScrollBody>
    </Panel>
  );
}
