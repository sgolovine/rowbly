import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Conversation, openConversation } from "../../../services/conversation/conversation.js";
import { useTestProject } from "../../../services/test-project/test-project.js";
import { createThread, transitionThread } from "../../../services/thread/thread.js";
import { keys, renderTui, settle } from "../../testing/index.js";
import { ConversationView } from "./conversation-view.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("The viewer must not load Pi");
});

afterEach(cleanup);

const header = { type: "session", version: 3, id: "s", timestamp: "2026-11-12T10:00:00.000Z", cwd: "/p" };
/** `count` user messages `m1`…`mN`, each the child of the one before. */
const messages = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const n = from + i;
    return {
      type: "message",
      id: `m${n}`,
      parentId: n === 1 ? null : `m${n - 1}`,
      timestamp: "2026-11-12T10:00:00.000Z",
      message: { role: "user", content: `message ${n}` },
    };
  });
const jsonl = (values: unknown[]) => `${values.map((v) => JSON.stringify(v)).join("\n")}\n`;

describe("ConversationView", () => {
  const project = useTestProject();

  async function thread(entries: unknown[]) {
    const t = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "o" },
      project.ctx,
    );
    const file = `sessions/${t.id}/history.jsonl`;
    await mkdir(join(project.paths.runtimeDir, `sessions/${t.id}`), { recursive: true });
    await writeFile(join(project.paths.runtimeDir, file), jsonl([header, ...entries]));
    await transitionThread(
      t.id,
      { expectedRevision: 1, status: "running", patch: { session: { id: t.id, file } } },
      project.ctx,
    );
    return { id: t.id, path: join(project.paths.runtimeDir, file) };
  }

  /** Opens the view with a spy on `openConversation` and on the `close` of the conversation. */
  async function view(id: string, props: { live?: boolean; height?: number } = {}) {
    const opened: Conversation[] = [];
    const open = vi.fn(async (threadId: string, ctx: Parameters<typeof openConversation>[1]) => {
      const c = await openConversation(threadId, ctx);
      vi.spyOn(c, "close");
      vi.spyOn(c, "read");
      opened.push(c);
      return c;
    });
    const tui = await renderTui(
      <ConversationView
        ctx={project.ctx}
        threadId={id}
        live={props.live ?? false}
        active
        width={60}
        height={props.height}
        open={open}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).not.toContain("Loading");
    });
    return { tui, open, opened };
  }

  it("opens only the file of its thread and shows the newest page", async () => {
    const other = await thread(messages(1, 3));
    const { id } = await thread(messages(1, 30));
    const { tui, open } = await view(id);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(id, project.ctx);
    expect(open).not.toHaveBeenCalledWith(other.id, expect.anything());
    expect(tui.frame()).toContain("message 30");
    expect(tui.frame()).toContain("message 11");
    expect(tui.frame()).not.toContain("message 10\n");
    expect(tui.frame()).toContain("↑ older");
  });

  it("shows tool calls and tool results", async () => {
    const { id } = await thread([
      {
        type: "message",
        id: "a",
        parentId: null,
        timestamp: header.timestamp,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I look." },
            { type: "toolCall", id: "c", name: "bash", arguments: { command: "ls" } },
          ],
        },
      },
      {
        type: "message",
        id: "b",
        parentId: "a",
        timestamp: header.timestamp,
        message: {
          role: "toolResult",
          toolCallId: "c",
          toolName: "bash",
          isError: true,
          content: [{ type: "text", text: "no such file" }],
        },
      },
    ]);
    const { tui } = await view(id);
    expect(tui.frame()).toMatch(/Agent · 12 Nov 2026/);
    expect(tui.frame()).toContain("Tool call · bash");
    expect(tui.frame()).toContain('{"command":"ls"}');
    expect(tui.frame()).toMatch(/Tool result · bash · 12 Nov 2026, \d\d:\d\d · error/);
    expect(tui.frame()).toContain("no such file");
  });

  it("reads older pages at the top and keeps at most three pages", async () => {
    const { id } = await thread(messages(1, 100));
    const { tui, opened } = await view(id, { height: 10 });
    for (let i = 0; i < 80 && !tui.frame().includes("message 1\n"); i++) await tui.press(keys.pageUp);
    expect(tui.frame()).toContain("message 1\n");
    const reads = vi.mocked(opened[0]?.read as Conversation["read"]).mock.calls;
    expect(reads.filter(([input]) => input?.before)).toHaveLength(4);
    expect(tui.frame()).toContain("↓ newer");
    // Back down: the newer pages come back through the forward cursor.
    for (let i = 0; i < 200 && !tui.frame().includes("message 100"); i++) await tui.press(keys.pageDown);
    expect(tui.frame()).toContain("message 100");
    expect(reads.some(([input]) => input?.after)).toBe(true);
  });

  it("follows a running thread, stops at a scroll up without a jump, and follows again with end", async () => {
    const { id, path } = await thread(messages(1, 30));
    const { tui } = await view(id, { live: true, height: 10 });
    expect(tui.frame()).toContain("following");
    await appendFile(path, jsonl(messages(31, 1)));
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("message 31");
    });
    await tui.press(keys.up, keys.up, keys.up);
    const reading = tui.frame().split("\n").slice(0, -1).join("\n");
    expect(tui.frame()).toContain("f follow");
    await appendFile(path, jsonl(messages(32, 1)));
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("↓ new entries");
    });
    expect(tui.frame().split("\n").slice(0, -1).join("\n")).toBe(reading);
    await tui.press(keys.end);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("message 32");
    });
    expect(tui.frame()).toContain("following");
  });

  it("closes the conversation, its index and its watch when it closes or the thread changes", async () => {
    const first = await thread(messages(1, 3));
    const second = await thread(messages(1, 3));
    const { tui, opened, open } = await view(first.id, { live: true });
    await tui.rerender(<ConversationView ctx={project.ctx} threadId={second.id} live active width={60} open={open} />);
    await settle(50);
    expect(opened[0]?.close).toHaveBeenCalled();
    tui.unmount();
    await settle(20);
    expect(opened[1]?.close).toHaveBeenCalled();
    await expect(opened[1]?.read()).rejects.toThrow("closed");
  });

  it("says when the thread has no conversation yet", async () => {
    const t = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "o" },
      project.ctx,
    );
    const { tui } = await view(t.id);
    expect(tui.frame()).toContain("No conversation yet");
  });
});
