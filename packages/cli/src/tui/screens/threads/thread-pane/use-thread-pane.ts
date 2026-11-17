import { type Key, useInput } from "ink";
import { useEffect, useState } from "react";
import { getThread, type ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type FullScreenConversationControl, useFullScreenConversation } from "../../../components/index.js";
import {
  type Layout,
  useAsync,
  useClock,
  useEscape,
  useIsActive,
  useLayout,
  useOverlayOpen,
  useThreadChanges,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { threadName } from "../../stories/index.js";

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
  /** A wheel notch over the conversation while the pane does not have the focus: the focus goes to the pane. */
  onFocus(): void;
  /** The Button and the conversation of the pane take the mouse. */
  readonly clickable: boolean;
  /** `o` or the `Open Story` Button: opens the Story of the Thread. `undefined` when the board has no such Story. */
  readonly onOpenStory: (() => void) | undefined;
  /** The keys of the pane, for the footer. */
  onHints(hints: readonly KeyHint[]): void;
}

/** The state of the Thread pane that its render reads. */
export interface ThreadPaneModel {
  /** The pane takes the keys: it has the focus, and the full-screen view is not open. */
  readonly active: boolean;
  /** The steering input takes the keys. */
  readonly steering: boolean;
  readonly setSteering: (steering: boolean) => void;
  /** The conversation over the whole terminal, which `ctrl+f` opens. */
  readonly full: FullScreenConversationControl;
  readonly current: ThreadRecord;
  readonly now: number;
  readonly layout: Layout;
}

/** The handlers of the keys of the pane that are not the keys of the conversation. */
interface PaneKeys extends Pick<ThreadPaneProps, "onTab" | "onOpenStory"> {
  readonly full: FullScreenConversationControl;
  /** The Thread is a running worker, so that `m` can focus the steering input. */
  readonly steerable: boolean;
  readonly setSteering: (steering: boolean) => void;
}

/** The title of the full-screen view: the same text as the title of the Story sidebar. */
function fullScreenTitle(thread: ThreadRecord, stages: Readonly<Record<string, string>>): string {
  return `${thread.storyId ?? "—"} › ${threadName(thread, stages)}`;
}

/**
 * `tab` and `shift+tab` move the focus to another pane of the shell. `o` opens the Story of the Thread. `ctrl+f`
 * opens the conversation full screen. `m` focuses the steering input of a running Thread.
 */
function paneKey(input: string, key: Key, keys: PaneKeys): void {
  if (key.ctrl && input === "f") {
    keys.full.open();

    return;
  }

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
 * The live Thread, the run time and the keys of the Thread pane. `esc` gives the focus back to the list, `o` opens the
 * Story, `ctrl+f` opens the conversation full screen and `m` focuses the steering input. While the full-screen view is
 * open, the pane takes no keys. While the input has the focus, the other keys do not act.
 */
export function useThreadPane(props: ThreadPaneProps): ThreadPaneModel {
  const { ctx, root, thread, stages, onBack, onTab, onOpenStory } = props;
  const focused = useIsActive();
  const covered = useOverlayOpen();
  const layout = useLayout();
  const fresh = useAsync(() => getThread(thread.id, ctx), [ctx, thread.id]);
  const [steeringState, setSteering] = useState(false);
  const current = fresh.data ?? thread;
  const live = current.status === "running";
  const full = useFullScreenConversation({ ctx, threadId: current.id, live, title: fullScreenTitle(current, stages) });
  const active = focused && !full.isOpen;
  const steerable = live && current.role === "worker";
  const steering = active && steerable && steeringState;
  const paneKeys = active && !steering;
  // The clock stops while a full-screen view covers the pane.
  const now = useClock(live && !full.isOpen && !covered);

  // The worker writes its Thread file from another process.
  useThreadChanges(root, fresh.refresh);
  useSteerReset(steerable, steeringState, setSteering);
  useEscape(paneKeys, onBack);
  useInput((input, key) => paneKey(input, key, { onTab, onOpenStory, full, steerable, setSteering }), {
    isActive: paneKeys,
  });

  return { active, steering, setSteering, full, current, now, layout };
}
