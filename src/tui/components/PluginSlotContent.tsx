import { type ReactNode, useMemo } from 'react';
import type { PluginContext, PluginUi } from '../../services';
import { usePluginUi, useServices } from '../hooks';

/**
 * Calls Plugin `pluginId`'s `render` with its context and UI. It is the child of the slot's
 * `PluginBoundary`, so that the boundary encloses the callback as well as what it returns.
 */
export function PluginSlotContent({
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
