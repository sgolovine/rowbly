import { useWindowSize } from "ink";
import { type ReactNode, useContext, useMemo, useState } from "react";
import { ActiveContext, LayoutContext, type MainOverlay, MainOverlayContext } from "../../hooks/index.js";

/**
 * Hosts what is drawn over everything: a node opened with `useMainOverlay()` (a `FullScreenEditor`,
 * a `SearchableSelect` picker). While it is open, `children` take no keys. `TuiProviders` puts one around the whole app.
 * `fullscreen` is false in tests and piped output, where an overlay grows with its content instead
 * of filling the terminal.
 */
export function OverlayHost({ fullscreen = true, children }: { fullscreen?: boolean; children: ReactNode }) {
  const { columns, rows } = useWindowSize();
  const active = useContext(ActiveContext);
  const [overlay, setOverlay] = useState<{ id: string; node: ReactNode } | null>(null);
  const mainOverlay = useMemo<MainOverlay>(
    () => ({
      open: (id, node) => setOverlay({ id, node }),
      close: (id) => setOverlay((current) => (current?.id === id ? null : current)),
    }),
    [],
  );

  return (
    <MainOverlayContext.Provider value={mainOverlay}>
      <ActiveContext.Provider value={active && overlay === null}>{children}</ActiveContext.Provider>
      {overlay && (
        // Over the whole terminal; the Modal inside keeps its margin to the edges.
        <LayoutContext.Provider value={{ width: columns, height: fullscreen ? rows : undefined }}>
          {overlay.node}
        </LayoutContext.Provider>
      )}
    </MainOverlayContext.Provider>
  );
}
