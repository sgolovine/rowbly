import { Fragment, useSyncExternalStore } from 'react';
import type { LayerHost } from './modalLayer';

/** Draws the layers shown over a modal's body, in the order they opened. */
export function LayerOutlet({ host }: { host: LayerHost }) {
  const layers = useSyncExternalStore(host.subscribe, host.layers);
  return (
    <>
      {[...layers].map(([id, node]) => (
        <Fragment key={id}>{node}</Fragment>
      ))}
    </>
  );
}
