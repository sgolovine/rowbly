import { Box, Text } from 'ink';
import { useContext, useMemo, useState } from 'react';
import {
  ActiveContext,
  pluginRoute,
  ShellContext,
  sectionShell,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
} from '../../hooks';
import type { KeyHint } from '../../keymap';
import { pluginsScreens } from '../plugins';

/**
 * A Plugin screen drawn in onboarding's main area, as a settings section is, rather than pushed as a
 * Modal. `esc` returns to the step that opened it unless the screen holds `esc` itself (a dialog).
 */
export function OnboardingPluginStep({
  title,
  plugin,
  screen,
  onBack,
}: {
  title: string;
  plugin: string;
  screen: string;
  onBack(): void;
}) {
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const [hints, setHints] = useState<readonly KeyHint[]>([]);
  const childShell = useMemo(() => sectionShell(shell, setHints), [shell]);
  const route = pluginRoute(plugin, screen, { title });
  const Screen = pluginsScreens[route.screen];
  useKeyCapture(active, { text: false, escape: true });
  useEscape(active, () => {
    if (!childShell.holdsEscape()) onBack();
  });
  useKeyHints(
    hints.some((hint) => hint.key === 'esc') ? hints : [...hints, { key: 'esc', description: 'back to onboarding' }],
  );
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{title}</Text>
      <ShellContext.Provider value={childShell}>
        <ActiveContext.Provider value={active}>{Screen && <Screen params={route.params} />}</ActiveContext.Provider>
      </ShellContext.Provider>
    </Box>
  );
}
