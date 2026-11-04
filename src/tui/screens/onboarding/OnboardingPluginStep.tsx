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
 * Modal. With `onBack`, `esc` returns to the step that opened it unless the screen holds `esc` itself
 * (a dialog).
 */
export function OnboardingPluginStep({
  title,
  plugin,
  screen,
  params,
  onBack,
}: {
  title: string;
  plugin: string;
  screen: string;
  params?: Record<string, unknown>;
  onBack?(): void;
}) {
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const [hints, setHints] = useState<readonly KeyHint[]>([]);
  const childShell = useMemo(() => sectionShell(shell, setHints), [shell]);
  const route = pluginRoute(plugin, screen, { ...params, title });
  const Screen = pluginsScreens[route.screen];
  useKeyCapture(active && onBack !== undefined, { text: false, escape: true });
  useEscape(active && onBack !== undefined, () => {
    if (!childShell.holdsEscape()) onBack?.();
  });
  useKeyHints(
    !onBack || hints.some((hint) => hint.key === 'esc')
      ? hints
      : [...hints, { key: 'esc', description: 'back to onboarding' }],
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
