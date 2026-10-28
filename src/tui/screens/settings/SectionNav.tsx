import { Box, Text } from 'ink';
import { ScrollBody } from '../../components';
import { useLayout } from '../../hooks';
import { theme } from '../../theme';
import { SectionNavItem } from './SectionNavItem';
import type { SettingsGroup } from './sections';

/** Width of the settings sidebar, including its right border. */
export const SECTION_NAV_WIDTH = 22;

export function SectionNav({
  groups,
  selected,
  clickable,
  focused,
  onSelect,
}: {
  groups: readonly SettingsGroup[];
  /** The `id` of the selected section. */
  selected: string;
  clickable: boolean;
  focused: boolean;
  onSelect(id: string): void;
}) {
  const layout = useLayout();
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      width={SECTION_NAV_WIDTH}
      borderStyle="single"
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      borderColor={theme.border}
    >
      <ScrollBody height={layout.height} active={focused}>
        <Box flexDirection="column" gap={1}>
          {groups.map((group) => (
            <Box key={group.title} flexDirection="column" flexShrink={0}>
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
      </ScrollBody>
    </Box>
  );
}
