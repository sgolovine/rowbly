import { Text } from 'ink';
import { useMemo } from 'react';
import { PluginBoundary } from '../../components';
import { usePlugins, usePluginUi, useServices } from '../../hooks';
import type { ScreenProps } from '../types';

/** A route param that names something: a nonempty string, or `undefined`. */
function nameParam(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * A Plugin's screen: `params.screen` of Plugin `params.plugin`, with the other params passed on.
 * `plugin` and `screen` are route metadata, never passed on; `title` is the breadcrumb, passed on
 * too. A failure while the screen renders stays on this screen (RES-13).
 */
export function PluginScreenHost({ params }: ScreenProps) {
  const services = useServices();
  const { plugins } = usePlugins();
  const { plugin, screen, ...rest } = params;
  const id = nameParam(plugin);
  const name = nameParam(screen);
  const ui = usePluginUi(id ?? '');
  const context = useMemo(() => {
    if (id === undefined) return null;
    try {
      return services.plugins.context(id);
    } catch {
      return null;
    }
  }, [services, id]);
  if (id === undefined) return <Text color="red">Invalid route: a Plugin screen was opened without a Plugin.</Text>;
  if (name === undefined) {
    return <Text color="red">{`Invalid route: Plugin "${id}" opened a screen without a screen name.`}</Text>;
  }
  const loaded = plugins.find((p) => p.id === id);
  const screens = loaded?.tui.screens;
  const Screen = screens && Object.hasOwn(screens, name) ? screens[name] : undefined;
  if (!Screen || !context) return <Text color="red">{`Plugin "${id}" has no screen "${name}".`}</Text>;
  return (
    <PluginBoundary pluginId={id} resetKeys={[id, name, loaded]}>
      <Screen params={rest} plugin={context} ui={ui} />
    </PluginBoundary>
  );
}
