import { watch } from "node:fs";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

/** One save writes more than one event, so the callback waits for this quiet time. */
const QUIET_MS = 100;

/**
 * Calls `onChange` after files in the stories folder change, also from a different process. Returns the
 * function that stops the watch. The watch does not keep the process alive.
 */
export async function watchStories(onChange: () => void, ctx: ServiceContext = {}): Promise<() => void> {
  const paths = await findProject(ctx);
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(paths.storiesDir, { persistent: false }, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, QUIET_MS);
  });
  // The folder can go away while Rowbly runs. Without a listener, this error stops the process.
  watcher.on("error", () => watcher.close());
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
