import { watch } from "node:fs";
import { Store } from "../store/store.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

interface WatchEnv {
  readonly onChange: () => void;
  readonly factory: boolean;
  readonly debounce: Store<{ timer?: NodeJS.Timeout }>;
}

const QUIET_MS = 100;

function isFactoryFile(name: string): boolean {
  return name === "runtime/status.json" || name === "runtime/factory.lock" || name === "runtime";
}

/** Calls `onChange` after 100 ms without a further change of a watched file. */
function onFileChange(env: WatchEnv, file: string | Buffer | null): void {
  const name = file?.toString() ?? "";

  if (!name.startsWith("runtime/threads") && !(env.factory && isFactoryFile(name))) {
    return;
  }

  clearTimeout(env.debounce.current.timer);
  env.debounce.update(() => ({ timer: setTimeout(env.onChange, QUIET_MS) }));
}

/**
 * Calls `onChange` after thread metadata changes, also from a different process. With `factory`, a change
 * of the factory status or owner also calls it. Session histories and logs do not call it. The watch waits
 * for 100 ms of quiet, and it does not keep the process alive. Returns the function that stops the watch.
 */
export async function watchThreads(
  onChange: () => void,
  ctx: ServiceContext = {},
  options: { factory?: boolean } = {},
): Promise<() => void> {
  const paths = await findProject(ctx);
  const env: WatchEnv = { onChange, factory: !!options.factory, debounce: new Store({}) };

  // Watch the Project too, so the first runtime directory is observable without writes.
  const watcher = watch(paths.dir, { persistent: false, recursive: true }, (_event, file) => onFileChange(env, file));

  watcher.on("error", () => watcher.close());

  return () => {
    clearTimeout(env.debounce.current.timer);
    watcher.close();
  };
}
