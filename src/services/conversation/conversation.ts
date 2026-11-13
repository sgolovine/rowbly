import { ValidationError } from "../errors/errors.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { getThread } from "../thread/thread.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { type ConversationPage, SessionIndex } from "./session-index.js";

export type { ConversationEntry, ConversationPage } from "./session-index.js";
export type ConversationCursor = string;
export interface Conversation {
  threadId: string;
  read(input?: {
    before?: ConversationCursor | null;
    after?: ConversationCursor | null;
    limit?: number;
    maxBytes?: number;
  }): Promise<ConversationPage>;
  watch(onChange: (page: ConversationPage) => void, onError?: (error: unknown) => void): () => void;
  close(): void;
}
/** Opens only the selected thread. A read never resumes Pi or repairs its files. */
export async function openConversation(threadId: string, ctx: ServiceContext = {}): Promise<Conversation> {
  await getThread(threadId, ctx);
  const paths = await findProject(ctx);
  let index: SessionIndex | undefined,
    reference: string | null = null,
    closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const stops = new Set<() => void>();
  const conversation: Conversation = {
    threadId,
    read(input = {}) {
      const read = async (): Promise<ConversationPage> => {
        if (closed) {
          throw new ValidationError("Conversation is closed");
        }
        const thread = await getThread(threadId, ctx);
        if (closed) {
          throw new ValidationError("Conversation is closed");
        }
        if (thread.session.file !== reference) {
          index?.close();
          index = undefined;
          reference = thread.session.file;
        }
        if (!reference) {
          return { entries: [], nextBefore: null, bytes: 0, status: "missing", invalidLines: 0 };
        }
        const selected = reference;
        index ??= new SessionIndex(await runtimePath(paths, selected), () => runtimePath(paths, selected));
        const current = index;
        const page = await current.page({ ...input, leaf: thread.session.leafId });
        if (closed) {
          current.close();
          throw new ValidationError("Conversation is closed");
        }
        return page;
      };
      const pending = queue.then(read).catch((error: unknown) => {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (typeof code === "string" && /^E[A-Z]+$/.test(code)) {
          throw new ValidationError(`Conversation file is unavailable (${code})`);
        }
        throw error;
      });
      queue = pending.catch(() => {});
      return pending;
    },
    watch(onChange, onError = () => {}) {
      if (closed) {
        throw new ValidationError("Conversation is closed");
      }
      let active = true,
        busy = false,
        previous = "";
      const tick = async () => {
        if (!active || busy) {
          return;
        }
        busy = true;
        try {
          const page = await conversation.read();
          const digest = JSON.stringify(page);
          if (active && digest !== previous) {
            previous = digest;
            onChange(page);
          }
        } catch (error) {
          if (active) {
            onError(error);
          }
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(() => void tick(), 500);
      timer.unref();
      const stop = () => {
        active = false;
        clearInterval(timer);
        stops.delete(stop);
      };
      stops.add(stop);
      void tick();
      return stop;
    },
    close() {
      closed = true;
      for (const stop of stops) {
        stop();
      }
      index?.close();
      index = undefined;
    },
  };
  return conversation;
}
export function readConversationPage(conversation: Conversation, input?: Parameters<Conversation["read"]>[0]) {
  return conversation.read(input);
}
export function watchConversation(
  conversation: Conversation,
  onChange: (page: ConversationPage) => void,
  onError?: (error: unknown) => void,
) {
  return conversation.watch(onChange, onError);
}
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
