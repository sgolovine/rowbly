import type { ReactNode } from 'react';
import type { PluginContext, PluginUi } from '../../services';
import { usePlugins } from '../hooks';
import { PluginBoundary } from './PluginBoundary';
import { PluginLayerScope } from './PluginLayerScope';
import { PluginSlotContent } from './PluginSlotContent';

/**
 * Renders what Plugin `pluginId` adds to a core screen, giving it its context and UI. A failure while
 * it renders stays inside the slot (RES-13); the slot tries again once the Plugin is loaded again.
 */
export function PluginSlot({
  pluginId,
  render,
  onFailure,
}: {
  pluginId: string;
  onFailure?(): void;
  render(context: PluginContext, ui: PluginUi): ReactNode;
}) {
  const loaded = usePlugins().plugins.find((plugin) => plugin.id === pluginId);
  return (
    <PluginBoundary onFailure={onFailure} pluginId={pluginId} resetKeys={[pluginId, loaded]}>
      <PluginLayerScope pluginId={pluginId} resetKeys={[pluginId, loaded]}>
        <PluginSlotContent pluginId={pluginId} render={render} />
      </PluginLayerScope>
    </PluginBoundary>
  );
}
