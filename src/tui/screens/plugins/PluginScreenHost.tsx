import { Text } from 'ink';
import { PluginBoundary, PluginLayerScope } from '../../components';
import { usePluginScreenContext, usePlugins, usePluginUi } from '../../hooks';
import { theme } from '../../theme';
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
  const { plugins } = usePlugins();
  const { plugin, screen, ...rest } = params;
  const id = nameParam(plugin);
  const name = nameParam(screen);
  const ui = usePluginUi(id ?? '');
  const context = usePluginScreenContext(id);
  if (id === undefined)
    return <Text color={theme.danger}>Invalid route: a Plugin screen was opened without a Plugin.</Text>;
  if (name === undefined) {
    return <Text color={theme.danger}>{`Invalid route: Plugin "${id}" opened a screen without a screen name.`}</Text>;
  }
  const loaded = plugins.find((p) => p.id === id);
  const screens = loaded?.tui.screens;
  const Screen = screens && Object.hasOwn(screens, name) ? screens[name] : undefined;
  if (!Screen) return <Text color={theme.danger}>{`Plugin "${id}" has no screen "${name}".`}</Text>;
  if (!context) return null;
  return (
    <PluginBoundary pluginId={id} resetKeys={[id, name, loaded]}>
      <PluginLayerScope pluginId={id} resetKeys={[id, name, loaded]}>
        <Screen params={rest} plugin={context} ui={ui} />
      </PluginLayerScope>
    </PluginBoundary>
  );
}
