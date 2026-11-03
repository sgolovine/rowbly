import type { ReactNode } from 'react';
import type { PluginContext, PluginUi } from '../../services';
import { usePluginScreenContext, usePluginUi } from '../hooks';

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
  const ui = usePluginUi(pluginId);
  const context = usePluginScreenContext(pluginId);
  return context ? render(context, ui) : null;
}
