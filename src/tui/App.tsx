import type { EventEmitter } from "node:events";
import type { ServiceContext } from "../services/workspace/workspace.js";
import type { ToastStore } from "./hooks/index.js";
import { Shell } from "./shell/index.js";
import { TuiProviders } from "./TuiProviders.js";

/** The root of the TUI: the providers around the shell. */
export function App({
  toasts,
  mouse,
  ctx,
  fullscreen = true,
}: {
  toasts: ToastStore;
  /** The emitter of mouse events from `runFullScreen`. */
  mouse?: EventEmitter;
  /** Where the services look for the project. Defaults to the directory where Rowbly runs. */
  ctx?: ServiceContext;
  /** False in tests and piped output, where the app does not fill the terminal. */
  fullscreen?: boolean;
}) {
  return (
    <TuiProviders toasts={toasts} mouse={mouse} fullscreen={fullscreen}>
      <Shell ctx={ctx} />
    </TuiProviders>
  );
}
