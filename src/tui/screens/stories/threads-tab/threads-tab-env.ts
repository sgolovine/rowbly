import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { ToastStore } from "../../../hooks/index.js";
import type { StageNames } from "../thread-text.js";
import type { Focus } from "./threads-tab-view.js";

/** The environment of the handlers of the Threads tab. */
export interface ThreadsTabEnv {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  readonly stages: StageNames | undefined;
  readonly toast: ToastStore;
  readonly current: ThreadRecord | undefined;
  readonly cursor: number;
  /** True while a command waits for the factory, so that a second key sends no second command. */
  readonly sending: RefObject<boolean>;
  readonly refresh: () => void;
  readonly setFocus: Dispatch<SetStateAction<Focus>>;
  readonly setConfirm: Dispatch<SetStateAction<ThreadRecord | null>>;
  /** The number of held entries of each abandoned thread, by thread id. */
  readonly held: Readonly<Record<string, number>>;
  /** Opens or closes the confirmation of the discard of the held entries of a thread. */
  readonly setDiscard: Dispatch<SetStateAction<ThreadRecord | null>>;
  readonly setCursor: (index: number) => void;
  /** Opens the conversation full screen. `undefined` while the thread region shows no conversation. */
  readonly openFullScreen: (() => void) | undefined;
}
