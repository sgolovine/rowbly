import { Box, Text, useInput } from 'ink';
import { useContext, useMemo, useState } from 'react';
import { UsageError } from '../../../core';
import { Loading, ScrollBody } from '../../components';
import {
  ActiveContext,
  LayoutContext,
  ShellContext,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useLayout,
  usePlugins,
  useServices,
} from '../../hooks';
import { type KeyHint, moveDelta } from '../../keymap';
import { theme } from '../../theme';
import { SECTION_NAV_WIDTH, SectionNav } from './SectionNav';
import { sectionShell } from './sectionShell';
import { sectionScreen, settingsGroups } from './sections';

type Focus = 'nav' | 'section';

/**
 * Rowbly's settings (`,`): the sections down the left, grouped into the global ones and those of the
 * Board in context, and the selected one's screen on the right. `tab` moves focus between the two;
 * screens a section opens stack on top as usual.
 */
export function SettingsScreen() {
  const services = useServices();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const layout = useLayout();
  // Resolved again when the screen is back on top, in case a section switched the Board.
  const board = useAsync(async () => {
    try {
      return await services.boards.get(await services.context.resolveBoard());
    } catch (err) {
      if (err instanceof UsageError) return null;
      throw err;
    }
  }, [services, active]);
  const { plugins } = usePlugins();
  const groups = useMemo(() => settingsGroups(board.data ?? null, plugins), [board.data, plugins]);
  const sections = groups.flatMap((group) => group.sections);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>('nav');
  const [sectionHints, setSectionHints] = useState<readonly KeyHint[]>([]);
  const childShell = useMemo(() => sectionShell(shell, setSectionHints), [shell]);
  const selected = Math.max(
    0,
    sections.findIndex((s) => s.id === selectedId),
  );
  const section = sections[selected];
  const Section = section ? sectionScreen(section) : undefined;

  useKeyCapture(active && focus === 'section', { escape: true });
  useEscape(active && focus === 'section', () => setFocus('nav'));
  useKeyHints(
    focus === 'nav'
      ? [
          { key: '↑/↓', description: 'section' },
          { key: 'enter/tab', description: 'open section' },
        ]
      : [...sectionHints, { key: 'esc', description: 'back to sections' }, { key: 'tab', description: 'sections' }],
  );
  useInput(
    (input, key) => {
      if (shell.captured().text) return;
      if (focus === 'section') {
        if (key.tab) setFocus('nav');
        return;
      }
      const delta = moveDelta(input, key);
      if (delta !== 0) setSelectedId(sections[(selected + delta + sections.length) % sections.length]?.id ?? null);
      else if (key.tab || key.return || key.rightArrow) setFocus('section');
    },
    { isActive: active && board.data !== undefined },
  );

  if (board.data === undefined && board.loading) return <Loading label="Loading settings…" />;
  const sectionLayout = {
    width: Math.max(20, layout.width - SECTION_NAV_WIDTH - 2),
    height: layout.height === undefined ? undefined : Math.max(1, layout.height - 3),
  };
  return (
    <Box height={layout.height} gap={2}>
      <SectionNav
        groups={groups}
        selected={section?.id ?? ''}
        focused={focus === 'nav'}
        clickable={active}
        onSelect={(id) => {
          setSelectedId(id);
          setFocus('section');
        }}
      />
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        <Box backgroundColor={theme.overlayRaised} flexDirection="column" paddingX={1} flexShrink={0} marginBottom={1}>
          <Text color={theme.ink} bold>
            {section?.label ?? 'Settings'}
          </Text>
          <Text color={theme.inkFaint}>Manage {section?.label ?? 'settings'}.</Text>
        </Box>
        <ShellContext.Provider value={childShell}>
          <ActiveContext.Provider value={active && focus === 'section'}>
            <LayoutContext.Provider value={sectionLayout}>
              <ScrollBody height={sectionLayout.height}>
                {Section && section ? (
                  <Section key={section.id} params={section.params ?? {}} />
                ) : (
                  <Text color={theme.inkFaint}>Nothing to show.</Text>
                )}
              </ScrollBody>
            </LayoutContext.Provider>
          </ActiveContext.Provider>
        </ShellContext.Provider>
      </Box>
    </Box>
  );
}
