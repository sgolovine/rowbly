import { ValidationError } from "../errors/errors.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { getThread, type ThreadRecord } from "../thread/thread.js";
import { assertOpen, type ConversationEnv, type ReadInput } from "./conversation-state.js";
import { SessionIndex } from "./session-index.js";
import type { ConversationPage } from "./session-types.js";

/** Forgets the index when the Thread moved to a different session file. */
function followReference(env: ConversationEnv, file: string | null): void {
  const { index, reference } = env.store.current;

  if (file === reference) {
    return;
  }

  index?.close();
  env.store.update(() => ({ index: undefined, reference: file }));
}

async function currentIndex(env: ConversationEnv, file: string): Promise<SessionIndex> {
  const existing = env.store.current.index;

  if (existing) {
    return existing;
  }

  const index = new SessionIndex(await runtimePath(env.paths, file), () => runtimePath(env.paths, file));

  env.store.update(() => ({ index }));

  return index;
}

/** Reads the Thread record for one page read. A watch gives its own reader, which can reuse a cached record. */
export type ThreadLoader = (env: ConversationEnv) => Promise<ThreadRecord>;

function loadThread(env: ConversationEnv): Promise<ThreadRecord> {
  return getThread(env.threadId, env.ctx);
}

async function readThreadPage(env: ConversationEnv, input: ReadInput, load: ThreadLoader): Promise<ConversationPage> {
  assertOpen(env);

  const thread = await load(env);

  assertOpen(env);
  followReference(env, thread.session.file);

  const { reference } = env.store.current;

  if (!reference) {
    return { entries: [], nextBefore: null, bytes: 0, status: "missing", invalidLines: 0 };
  }

  const index = await currentIndex(env, reference);
  const page = await index.page({ ...input, leaf: thread.session.leafId });

  if (env.store.current.closed) {
    index.close();
    throw new ValidationError("Conversation is closed");
  }

  return page;
}

/** Gives a short error for a file system failure. Other errors stay as they are. */
export function fileProblem(error: unknown): never {
  const code = (error as NodeJS.ErrnoException)?.code;

  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) {
    throw new ValidationError(`Conversation file is unavailable (${code})`);
  }

  throw error;
}

/** Reads one page after the earlier reads of this conversation complete. */
export function queueRead(
  env: ConversationEnv,
  input: ReadInput,
  load: ThreadLoader = loadThread,
): Promise<ConversationPage> {
  const pending = env.store.current.queue.then(() => readThreadPage(env, input, load)).catch(fileProblem);

  env.store.update(() => ({ queue: pending.catch(() => {}) }));

  return pending;
}
