import type { EventEmitter } from "node:events";
import { useWindowSize } from "ink";
import { type ReactNode, useMemo } from "react";
import { OverlayHost } from "./components/index.js";
import {
  createMouseRegistry,
  createShellRegistry,
  LayoutContext,
  MouseContext,
  ShellContext,
  ToastContext,
  type ToastStore,
  useMouseSource,
} from "./hooks/index.js";

/**
 * The contexts every shared component reads: toasts, the shell registry (key capture, hints, dirty
 * forms), the mouse registry, the terminal's size as the layout, and the overlay host. Wrap the
 * whole app in it. Without `mouse` the app is keyboard-only.
 */
export function TuiProviders({
  toasts,
  mouse,
  fullscreen = true,
  children,
}: {
  toasts: ToastStore;
  /** The emitter `runFullScreen` passes to its app. */
  mouse?: EventEmitter;
  /** False in tests and piped output, where nothing fills the terminal. */
  fullscreen?: boolean;
  children: ReactNode;
}) {
  const shell = useMemo(createShellRegistry, []);
  const mouseRegistry = useMemo(createMouseRegistry, []);

  useMouseSource(mouseRegistry, mouse);

  const { columns, rows } = useWindowSize();
  const layout = useMemo(
    () => ({ width: columns, height: fullscreen ? rows : undefined }),
    [columns, rows, fullscreen],
  );

  return (
    <ToastContext.Provider value={toasts}>
      <ShellContext.Provider value={shell}>
        <MouseContext.Provider value={mouseRegistry}>
          <LayoutContext.Provider value={layout}>
            <OverlayHost fullscreen={fullscreen}>{children}</OverlayHost>
          </LayoutContext.Provider>
        </MouseContext.Provider>
      </ShellContext.Provider>
    </ToastContext.Provider>
  );
}
