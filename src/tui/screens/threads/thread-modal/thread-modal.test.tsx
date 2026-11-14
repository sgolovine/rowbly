import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as conversation from "../../../../services/conversation/conversation.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { createThread, transitionThread } from "../../../../services/thread/thread.js";
import { keys, renderTui } from "../../../testing/index.js";
import { ThreadModal } from "./thread-modal.js";

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

describe("ThreadModal", () => {
  const project = useTestProject();

  async function open() {
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
    const onClose = vi.fn();
    const tui = await renderTui(
      <ThreadModal
        ctx={project.ctx}
        root={project.paths.root}
        thread={thread}
        stages={{ DEVELOP: "Develop" }}
        onClose={onClose}
      />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("No conversation yet");
    });
    return { tui, thread, onClose };
  }

  it("shows the Story and the Thread in the title, the metadata and the live conversation", async () => {
    const { tui, thread } = await open();
    expect(tui.frame()).toContain("ROW-07 › #2 Develop");
    expect(tui.frame()).toMatch(/Status\s+▶ running/);
    expect(tui.frame()).toContain("anthropic/claude");
    expect(tui.frame()).toMatch(/f follow/);
    expect(tui.frame()).toMatch(/esc close/);
    expect(conversation.openConversation).toHaveBeenLastCalledWith(thread.id, project.ctx);
  });

  it("closes on esc and on the ✕", async () => {
    const { tui, onClose } = await open();
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
    await tui.click("✕");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows a change of the Thread file without a reopen", async () => {
    const { tui, thread } = await open();
    await transitionThread(thread.id, { expectedRevision: 2, status: "completed" }, project.ctx);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toMatch(/Status\s+✓ completed/);
    });
    expect(tui.frame()).not.toMatch(/f follow/);
  });
});
