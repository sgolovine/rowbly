import { type Key, useInput } from "ink";
import { useEffect, useState } from "react";
import { getThread, type ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type Layout, useAsync, useEscape, useIsActive, useLayout, useThreadChanges } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";

/** The props of `ThreadPane`. */
export interface ThreadPaneProps {
  readonly ctx: ServiceContext;
  /** The root of the Project, for the watch of the Thread files. */
  readonly root: string;
  /** The Thread as the Factory view read it. The pane reads it again when its file changes. */
  readonly thread: ThreadRecord;
  /** The names of the Stages by key. */
  readonly stages: Readonly<Record<string, string>>;
  /** `esc`: the focus goes back to the Thread list, and the pane stays open. */
  onBack(): void;
  /** `tab` (`1`) or `shift+tab` (`-1`): the focus goes to the next or the previous pane. */
  onTab(step: 1 | -1): void;
  /** The keys of the pane, for the footer. */
  onHints(hints: readonly KeyHint[]): void;
}

/** The state of the Thread pane that its render reads. */
export interface ThreadPaneModel {
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

/** `tab` and `shift+tab` move the focus to another pane of the shell. */
function tabKey(key: Key, onTab: (step: 1 | -1) => void): void {
  if (key.tab) {
    onTab(key.shift ? -1 : 1);
  }
}

/** The live Thread, the run time and the keys of the Thread pane. `esc` gives the focus back to the list. */
export function useThreadPane({ ctx, root, thread, onBack, onTab }: ThreadPaneProps): ThreadPaneModel {
  const active = useIsActive();
  const layout = useLayout();
  const fresh = useAsync(() => getThread(thread.id, ctx), [ctx, thread.id]);
  const current = fresh.data ?? thread;

  // The worker writes its Thread file from another process.
  useThreadChanges(root, fresh.refresh);
  useEscape(active, onBack);
  useInput((_input, key) => tabKey(key, onTab), { isActive: active });

  return { active, current, now: useNow(current.status === "running"), layout };
}
