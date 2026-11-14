import { ValidationError } from "../errors/errors.js";
import type { Store } from "../store/store.js";
import type { ThreadRecord } from "../thread/thread.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";
import type { SessionIndex } from "./session-index.js";
import type { ConversationPage } from "./session-types.js";

type ConversationCursor = string;

/** The cursors and the size limits of one page read. */
export interface ReadInput {
  before?: ConversationCursor | null;
  after?: ConversationCursor | null;
  limit?: number;
  maxBytes?: number;
}

/**
 * The state of one watch. `busy` prevents a second poll while a read is in progress.
 * The cached Thread and the file signatures let a poll stop early when no file changed.
 */
export interface WatchState {
  readonly active: boolean;
  readonly busy: boolean;
  /** The digest of the last page that the watch gave. */
  readonly previous: string;
  readonly timer?: NodeJS.Timeout;

  // Change check
  /** The Thread record of the last full read, and the signature of the Thread file before that read. */
  readonly thread?: ThreadRecord;
  readonly threadSignature?: string;
  /** The signature that the full read in progress records when it succeeds. */
  readonly pending?: string;
  /** The signature of the last successful poll. A failed poll removes it. */
  readonly signature?: string;
}

/** One watch of a conversation, with its callbacks and the store of its state. */
export interface WatchRun {
  readonly onChange: (page: ConversationPage) => void;
  readonly onError: (error: unknown) => void;
  readonly store: Store<WatchState>;
}

/** The state of one open conversation. The index follows the session file of the Thread. */
export interface ConversationState {
  readonly index?: SessionIndex;
  readonly reference: string | null;
  readonly closed: boolean;
  readonly queue: Promise<unknown>;
  readonly watches: ReadonlySet<WatchRun>;
}

/** The fixed environment of one open conversation, and the store of its state. */
export interface ConversationEnv {
  readonly threadId: string;
  readonly ctx: ServiceContext;
  readonly paths: ProjectPaths;
  readonly store: Store<ConversationState>;
}

/** Throws when the conversation is closed. */
export function assertOpen(env: ConversationEnv): void {
  if (env.store.current.closed) {
    throw new ValidationError("Conversation is closed");
  }
}
