import { useEffect, useState } from "react";
import { getThread, type ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  type Layout,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useLayout,
  useThreadChanges,
} from "../../../hooks/index.js";

/** The props of `ThreadModal`. */
export interface ThreadModalProps {
  readonly ctx: ServiceContext;
  /** The root of the Project, for the watch of the Thread files. */
  readonly root: string;
  /** The Thread as the Factory view read it. The Modal reads it again when its file changes. */
  readonly thread: ThreadRecord;
  /** The names of the Stages by key. */
  readonly stages: Readonly<Record<string, string>>;
  onClose(): void;
}

/** The state of the Thread Modal that its render reads. */
export interface ThreadModalModel {
  readonly active: boolean;
  readonly current: ThreadRecord;
  readonly now: number;
  readonly layout: Layout;
}

/** The time that counts up each second while the Thread runs, for its run time. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!running) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [running]);

  return now;
}

/** The live Thread, the run time and the keys of the Thread Modal. `esc` closes it. */
export function useThreadModal({ ctx, root, thread, onClose }: ThreadModalProps): ThreadModalModel {
  const active = useIsActive();
  const layout = useLayout();
  const fresh = useAsync(() => getThread(thread.id, ctx), [ctx, thread.id]);
  const current = fresh.data ?? thread;

  // The worker writes its Thread file from another process.
  useThreadChanges(root, fresh.refresh);
  useKeyCapture(active, { text: false, escape: true });
  useEscape(active, onClose);

  return { active, current, now: useNow(current.status === "running"), layout };
}
