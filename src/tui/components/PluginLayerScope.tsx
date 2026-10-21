import type { ReactNode } from 'react';
import { LayerWrapContext } from './modalLayer';
import { PluginBoundary } from './PluginBoundary';

/**
 * Inside Plugin `pluginId`'s screen or tab: a Modal it opens is drawn over the body of the modal
 * around it, and keeps a boundary of its own there, so its failure stays attributed to the Plugin.
 */
export function PluginLayerScope({
  pluginId,
  resetKeys,
  children,
}: {
  pluginId: string;
  resetKeys: readonly unknown[];
  children: ReactNode;
}) {
  const wrap = (node: ReactNode) => (
    <PluginBoundary pluginId={pluginId} resetKeys={resetKeys}>
      {node}
    </PluginBoundary>
  );
  return <LayerWrapContext.Provider value={wrap}>{children}</LayerWrapContext.Provider>;
}
