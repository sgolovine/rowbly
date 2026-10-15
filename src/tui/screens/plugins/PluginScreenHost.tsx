import { Text } from 'ink';
import { useMemo } from 'react';
import { usePlugins, usePluginUi, useServices } from '../../hooks';
import type { ScreenProps } from '../types';

/** A Plugin's screen: `params.screen` of Plugin `params.plugin`, with the other params passed on. */
export function PluginScreenHost({ params }: ScreenProps) {
  const services = useServices();
  const { plugins } = usePlugins();
  const { plugin: id, screen, ...rest } = params;
  const ui = usePluginUi(String(id));
  const context = useMemo(() => {
    try {
      return services.plugins.context(String(id));
    } catch {
      return null;
    }
  }, [services, id]);
  const Screen = plugins.find((p) => p.id === id)?.tui.screens?.[String(screen)];
  if (!Screen || !context)
    return <Text color="red">{`Plugin "${String(id)}" has no screen "${String(screen)}".`}</Text>;
  return <Screen params={rest} plugin={context} ui={ui} />;
}
