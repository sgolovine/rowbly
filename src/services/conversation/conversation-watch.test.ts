import { describe, expect, it, vi } from "vitest";
import { Store } from "../store/store.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "../thread/thread.js";
import type { ConversationEnv, ConversationState } from "./conversation-state.js";
import { startWatch } from "./conversation-watch.js";

describe("conversation watch", () => {
  const p = useTestProject();

  async function env(): Promise<ConversationEnv> {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);
    const initial: ConversationState = { reference: null, closed: false, queue: Promise.resolve(), watches: new Set() };

    return { threadId: t.id, ctx: p.ctx, paths: p.paths, store: new Store(initial) };
  }

  it("gives the first page once and forgets the watch on stop", async () => {
    const watched = await env();
    const changed = vi.fn();
    const stop = startWatch(watched, changed);

    expect(watched.store.current.watches.size).toBe(1);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(changed.mock.calls[0]?.[0]).toMatchObject({ status: "missing" });

    stop();
    stop();
    expect(watched.store.current.watches.size).toBe(0);
  });

  it("refuses a watch after close", async () => {
    const watched = await env();

    watched.store.update(() => ({ closed: true }));
    expect(() => startWatch(watched, vi.fn())).toThrow("Conversation is closed");
  });
});
