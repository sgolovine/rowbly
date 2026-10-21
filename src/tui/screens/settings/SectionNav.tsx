import { Box, Text } from 'ink';
import { theme } from '../../theme';
import { SectionNavItem } from './SectionNavItem';
import type { SettingsGroup } from './sections';

/** Width of the settings sidebar, including its right border. */
export const SECTION_NAV_WIDTH = 22;

export function SectionNav({
  groups,
  selected,
  clickable,
  onSelect,
}: {
  groups: readonly SettingsGroup[];
  /** The `id` of the selected section. */
  selected: string;
  clickable: boolean;
  onSelect(id: string): void;
}) {
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width={SECTION_NAV_WIDTH}
      gap={1}
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      borderColor={theme.border}
    >
      {groups.map((group) => (
        <Box key={group.title} flexDirection="column">
          <Text color={theme.inkFaint} wrap="truncate-end">
            {group.title}
          </Text>
          {group.sections.length === 0 && group.empty && (
            <Text color={theme.inkFaint} wrap="truncate-end">
              {`  ${group.empty}`}
            </Text>
          )}
          {group.sections.map((section) => (
            <SectionNavItem
              key={section.id}
              label={section.label}
              selected={section.id === selected}
              clickable={clickable}
              onClick={() => onSelect(section.id)}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}
