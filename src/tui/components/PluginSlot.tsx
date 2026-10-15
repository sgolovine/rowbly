import { type ReactNode, useMemo } from 'react';
import type { PluginContext, PluginUi } from '../../services';
import { usePluginUi, useServices } from '../hooks';

/** Renders what Plugin `pluginId` adds to a core screen, giving it its context and UI. */
export function PluginSlot({
  pluginId,
  render,
}: {
  pluginId: string;
  render(context: PluginContext, ui: PluginUi): ReactNode;
}) {
  const services = useServices();
  const ui = usePluginUi(pluginId);
  const context = useMemo(() => services.plugins.context(pluginId), [services, pluginId]);
  return <>{render(context, ui)}</>;
}
