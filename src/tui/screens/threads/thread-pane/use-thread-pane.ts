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
  /** The Button of the pane takes the mouse. */
  readonly clickable: boolean;
  /** `o` or the `Open Story` Button: opens the Story of the Thread. `undefined` when the board has no such Story. */
  readonly onOpenStory: (() => void) | undefined;
  /** The keys of the pane, for the footer. */
  onHints(hints: readonly KeyHint[]): void;
}

/** The state of the Thread pane that its render reads. */
export interface ThreadPaneModel {
  readonly active: boolean;
  /** The steering input takes the keys. */
  readonly steering: boolean;
  readonly setSteering: (steering: boolean) => void;
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

/** The handlers of the keys of the pane. */
interface PaneKeys extends Pick<ThreadPaneProps, "onTab" | "onOpenStory"> {
  /** The Thread is a running worker, so that `m` can focus the steering input. */
  readonly steerable: boolean;
  readonly setSteering: (steering: boolean) => void;
}

/**
 * `tab` and `shift+tab` move the focus to another pane of the shell. `o` opens the Story of the Thread. `m` focuses
 * the steering input of a running Thread.
 */
function paneKey(input: string, key: Key, keys: PaneKeys): void {
  if (key.tab) {
    keys.onTab(key.shift ? -1 : 1);

    return;
  }

  if (key.ctrl || key.meta) {
    return;
  }

  if (input === "o") {
    keys.onOpenStory?.();
  }

  if (input === "m" && keys.steerable) {
    keys.setSteering(true);
  }
}

/** Leaves the steering input when the Thread stops running. */
function useSteerReset(steerable: boolean, steering: boolean, setSteering: (steering: boolean) => void): void {
  useEffect(() => {
    if (!steerable && steering) {
      setSteering(false);
    }
  }, [steerable, steering, setSteering]);
}

/**
 * The live Thread, the run time and the keys of the Thread pane. `esc` gives the focus back to the list, `o` opens
 * the Story, and `m` focuses the steering input. While the input has the focus, the other keys do not act.
 */
export function useThreadPane({ ctx, root, thread, onBack, onTab, onOpenStory }: ThreadPaneProps): ThreadPaneModel {
  const active = useIsActive();
  const layout = useLayout();
  const fresh = useAsync(() => getThread(thread.id, ctx), [ctx, thread.id]);
  const [steeringState, setSteering] = useState(false);
  const current = fresh.data ?? thread;
  const live = current.status === "running";
  const steerable = live && current.role === "worker";
  const steering = active && steerable && steeringState;
  const paneKeys = active && !steering;

  // The worker writes its Thread file from another process.
  useThreadChanges(root, fresh.refresh);
  useSteerReset(steerable, steeringState, setSteering);
  useEscape(paneKeys, onBack);
  useInput((input, key) => paneKey(input, key, { onTab, onOpenStory, steerable, setSteering }), { isActive: paneKeys });

  return { active, steering, setSteering, current, now: useNow(live), layout };
}
