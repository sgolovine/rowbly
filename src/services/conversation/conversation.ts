import { Store } from "../store/store.js";
import { getThread } from "../thread/thread.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { queueRead } from "./conversation-read.js";
import type { ConversationEnv, ConversationState, ReadInput } from "./conversation-state.js";
import { startWatch, stopWatch } from "./conversation-watch.js";
import type { ConversationPage } from "./session-types.js";

export type { ConversationEntry, ConversationPage } from "./session-index.js";

export interface Conversation {
  threadId: string;
  read(input?: ReadInput): Promise<ConversationPage>;
  watch(onChange: (page: ConversationPage) => void, onError?: (error: unknown) => void): () => void;
  close(): void;
}

function closeEnv(env: ConversationEnv): void {
  const { watches } = env.store.update(() => ({ closed: true }));

  for (const run of watches) {
    stopWatch(env, run);
  }

  env.store.current.index?.close();
  env.store.update(() => ({ index: undefined }));
}

/** Opens only the selected thread. A read never resumes Pi or repairs its files. */
export async function openConversation(threadId: string, ctx: ServiceContext = {}): Promise<Conversation> {
  await getThread(threadId, ctx);

  const paths = await findProject(ctx);
  const initial: ConversationState = { reference: null, closed: false, queue: Promise.resolve(), watches: new Set() };
  const env: ConversationEnv = { threadId, ctx, paths, store: new Store(initial) };

  return {
    threadId,
    read: (input = {}) => queueRead(env, input),
    watch: (onChange, onError) => startWatch(env, onChange, onError),
    close: () => closeEnv(env),
  };
}

/** Reads one page of a conversation. */
export function readConversationPage(conversation: Conversation, input?: ReadInput): Promise<ConversationPage> {
  return conversation.read(input);
}

/** Watches a conversation, and gives the function that stops the watch. */
export function watchConversation(
  conversation: Conversation,
  onChange: (page: ConversationPage) => void,
  onError?: (error: unknown) => void,
): () => void {
  return conversation.watch(onChange, onError);
}

/** Closes a conversation and stops its watches. */
export function closeConversation(conversation: Conversation): void {
  conversation.close();
}

/** Returns a bounded tail for CLI output and explicit supervisor inspection. */
export async function getThreadLog(
  threadId: string,
  input: { tail?: number } = {},
  ctx: ServiceContext = {},
): Promise<ConversationPage> {
  const conversation = await openConversation(threadId, ctx);

  try {
    return await conversation.read({ limit: input.tail ?? 20 });
  } finally {
    conversation.close();
  }
}
