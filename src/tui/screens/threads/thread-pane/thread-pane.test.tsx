import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as conversation from "../../../../services/conversation/conversation.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { createThread, transitionThread } from "../../../../services/thread/thread.js";
import { LayoutContext } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { keys, renderTui } from "../../../testing/index.js";
import { ThreadPane, threadPaneHints } from "./thread-pane.js";

vi.mock("../../../../services/conversation/conversation.js", async (original) => {
  const actual = await original<typeof import("../../../../services/conversation/conversation.js")>();
  return { ...actual, openConversation: vi.fn(actual.openConversation) };
});
vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("A peek must not load Pi");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadPane", () => {
  const project = useTestProject();

  async function open(height = 24) {
    const created = await createThread(
      {
        role: "worker",
        storyId: "ROW-07",
        stage: "DEVELOP",
        attemptNumber: 2,
        cwd: project.paths.root,
        ownerToken: "owner",
        model: { provider: "anthropic", modelId: "claude" },
      },
      project.ctx,
    );
    const thread = await transitionThread(
      created.id,
      {
        expectedRevision: 1,
        status: "running",
        patch: { session: { id: created.id, file: `sessions/${created.id}/history.jsonl` } },
      },
      project.ctx,
    );
    const onBack = vi.fn();
    const onTab = vi.fn();
    const reported: (readonly KeyHint[])[] = [];
    const onHints = (hints: readonly KeyHint[]) => reported.push(hints);
    const tui = await renderTui(
      <LayoutContext.Provider value={{ width: 60, height }}>
        <ThreadPane
          ctx={project.ctx}
          root={project.paths.root}
          thread={thread}
          stages={{ DEVELOP: "Develop" }}
          onBack={onBack}
          onTab={onTab}
          onHints={onHints}
        />
      </LayoutContext.Provider>,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("No conversation yet");
    });
    return { tui, thread, onBack, onTab, lastHints: () => reported.at(-1) ?? [] };
  }

  it("shows the metadata and the live conversation, and reports its keys", async () => {
    const { tui, thread, lastHints } = await open();
    expect(tui.frame()).toMatch(/Status\s+▶ running/);
    expect(tui.frame()).toContain("anthropic/claude");
    expect(lastHints().map((hint) => hint.key)).toEqual(["↑/↓", "f", "pgup/pgdn", "home/end", "tab", "esc"]);
    expect(lastHints().at(-1)).toEqual({ key: "esc", description: "Thread list" });
    expect(conversation.openConversation).toHaveBeenLastCalledWith(thread.id, project.ctx);
  });

  it("gives the focus back to the list on esc, and to the next or the previous pane on tab", async () => {
    const { tui, onBack, onTab } = await open();
    await tui.press(keys.escape);
    expect(onBack).toHaveBeenCalledOnce();
    await tui.press(keys.tab);
    expect(onTab).toHaveBeenLastCalledWith(1);
    await tui.press(keys.shiftTab);
    expect(onTab).toHaveBeenLastCalledWith(-1);
  });

  it("shows a change of the Thread file without a reopen, and drops the follow key", async () => {
    const { tui, thread, lastHints } = await open();
    await transitionThread(thread.id, { expectedRevision: 2, status: "completed" }, project.ctx);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toMatch(/Status\s+✓ completed/);
    });
    expect(lastHints().map((hint) => hint.key)).not.toContain("f");
  });

  it("shows the checks of the Thread when they change", async () => {
    const { tui, thread } = await open();
    expect(tui.frame()).not.toContain("Check test");
    await transitionThread(
      thread.id,
      {
        expectedRevision: 2,
        status: "running",
        patch: { checks: [{ id: "j1", key: "test", scope: "full", status: "failed", durationSeconds: 75 }] },
      },
      project.ctx,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("Check test full · failed · 1m15s");
    });
    expect(tui.frame()).toContain("No conversation yet");
  });

  it("shows the compact detail in a short body", async () => {
    const { tui } = await open(12);
    expect(tui.frame()).not.toMatch(/Status\s+▶ running/);
    expect(tui.frame()).toContain("No conversation yet");
  });
});

describe("threadPaneHints", () => {
  it("lists follow only while the Thread runs", () => {
    expect(threadPaneHints(true).map((hint) => hint.key)).toContain("f");
    expect(threadPaneHints(false).map((hint) => hint.key)).not.toContain("f");
  });
});
