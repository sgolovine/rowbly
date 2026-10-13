import { type ReactNode, useMemo } from 'react';
import type { PluginContext, PluginUi } from '../../services';
import { usePluginUi, useServices } from '../hooks';

/** Renders what Plugin `plugin` adds to a core screen, giving it its context and UI. */
export function PluginSlot({
  plugin,
  render,
}: {
  plugin: string;
  render(context: PluginContext, ui: PluginUi): ReactNode;
}) {
  const services = useServices();
  const ui = usePluginUi(plugin);
  const context = useMemo(() => services.plugins.context(plugin), [services, plugin]);
  return <>{render(context, ui)}</>;
}
