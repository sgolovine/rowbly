import { Box } from "ink";
import { cleanup } from "ink-testing-library";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProject, updateProject } from "../../../services/project/project.js";
import { listStages } from "../../../services/stage/stage.js";
import { createStory, searchStories } from "../../../services/story/story.js";
import { useTestProject } from "../../../services/test-project/test-project.js";
import { createThread } from "../../../services/thread/thread.js";
import { STORY_SIDEBAR_MIN_WIDTH } from "../../components/index.js";
import { keys, renderTui, settle } from "../../testing/index.js";
import { theme } from "../../theme.js";
import type { SidePane } from "../overlay.js";
import { StorySidebar } from "./story-sidebar.js";

/** The frame colour of each Panel that renders, read from its `focused` prop as `Panel` reads it. */
const panelColours: { title: string | undefined; colour: string }[] = [];

vi.mock("../../components/index.js", async (original) => {
  const actual = await original<typeof import("../../components/index.js")>();
  return {
    ...actual,
    Panel: (props: ComponentProps<typeof actual.Panel>) => {
      panelColours.push({ title: props.title, colour: props.focused ? theme.accent : theme.border });
      return actual.Panel(props);
    },
  };
});

afterEach(() => {
  cleanup();
  panelColours.length = 0;
});

describe("StorySidebar", () => {
  const project = useTestProject();

  beforeEach(async () => {
    await createStory({ title: "Login" }, project.ctx);
  });

  async function setup(pane: (story: Awaited<ReturnType<typeof searchStories>>[number]) => SidePane, change = {}) {
    const [story] = await searchStories({}, project.ctx);
    const board = {
      project: await getProject(project.ctx),
      stages: await listStages(project.ctx),
      stories: await searchStories({}, project.ctx),
    };
    const on = {
      onResize: vi.fn(),
      onFocus: vi.fn(),
      onClose: vi.fn(),
      onBack: vi.fn(),
      onTab: vi.fn(),
      onSaved: vi.fn(),
      onDeleted: vi.fn(),
      onHints: vi.fn(),
    };
    const props = {
      pane: pane(story as NonNullable<typeof story>),
      board,
      ctx: project.ctx,
      cursorStage: undefined,
      width: 60,
      height: undefined,
      maxWidth: 80,
      shown: true,
      focused: true,
      clickable: true,
      ...on,
      ...change,
    };
    const tui = await renderTui(
      <Box paddingLeft={20}>
        <StorySidebar {...props} />
      </Box>,
    );
    return { tui, on, props };
  }

  it("shows the new Story form with its title and a ✕ at the right end of the top border", async () => {
    const { tui } = await setup(() => ({ kind: "new" }));
    const top = tui.frame().split("\n")[0];
    expect(top).toMatch(/^ {20}╭─New Story─+ ✕ ╮$/);
    expect(tui.frame()).toContain("Title");
    expect(tui.frame()).toContain("Description");
  });

  it("shows the edit form of a Story with its tabs, and Specs when the Project has Specs on", async () => {
    const { tui } = await setup((story) => ({ kind: "edit", story }));
    expect(tui.frame().split("\n")[0]).toMatch(/^ {20}╭─Edit ROW-01─+ ✕ ╮$/);
    expect(tui.frame()).toMatch(/General\s+Attachments\s+Threads/);
    expect(tui.frame()).toContain("Login");
    cleanup();
    await updateProject({ features: { specs: true } }, project.ctx);
    const specs = await setup((story) => ({ kind: "edit", story }));
    await vi.waitFor(async () => {
      await specs.tui.press();
      expect(specs.tui.frame()).toMatch(/General\s+Specs 0\s+Attachments\s+Threads/);
    });
  });

  it("draws its border in accent while it has the focus, and in border when it does not", async () => {
    await setup(() => ({ kind: "new" }));
    expect(panelColours.at(-1)).toEqual({ title: "New Story", colour: theme.accent });
    cleanup();
    await setup(() => ({ kind: "new" }), { focused: false });
    expect(panelColours.at(-1)).toEqual({ title: "New Story", colour: theme.border });
  });

  it("calls onClose on a click on the ✕", async () => {
    const { tui, on } = await setup(() => ({ kind: "new" }));
    await tui.click("✕");
    expect(on.onClose).toHaveBeenCalledOnce();
    expect(on.onFocus).not.toHaveBeenCalled();
  });

  it("calls onBack with esc and keeps the draft", async () => {
    const { tui, on } = await setup(() => ({ kind: "new" }));
    await tui.type("Draft");
    await tui.press(keys.escape);
    expect(on.onBack).toHaveBeenCalledOnce();
    expect(tui.frame()).toContain("Draft");
  });

  it("takes no keys without the focus, and a click in it asks for the focus", async () => {
    const { tui, on } = await setup(() => ({ kind: "new" }), { focused: false });
    await tui.type("Draft");
    await tui.press(keys.escape);
    expect(tui.frame()).not.toContain("Draft");
    expect(on.onBack).not.toHaveBeenCalled();
    await tui.click("Description");
    expect(on.onFocus).toHaveBeenCalledOnce();
  });

  it("ignores the mouse while not clickable", async () => {
    const { tui, on } = await setup(() => ({ kind: "new" }), { focused: false, clickable: false });
    await tui.click("✕");
    await tui.click("Description");
    expect(on.onClose).not.toHaveBeenCalled();
    expect(on.onFocus).not.toHaveBeenCalled();
  });

  it("reports the keys of the form for the footer, with esc to the Story list last", async () => {
    const { on } = await setup(() => ({ kind: "new" }));
    await vi.waitFor(() => {
      const hints = on.onHints.mock.lastCall?.[0] ?? [];
      expect(hints[0]).toEqual({ key: "ctrl+s", description: "save" });
      expect(hints.at(-1)).toEqual({ key: "esc", description: "Story list" });
    });
  });

  it("shows a Thread with its title, its detail and its conversation, and reports its keys", async () => {
    const thread = await createThread(
      {
        role: "worker",
        storyId: "ROW-01",
        stage: "BACKLOG",
        attemptNumber: 1,
        cwd: project.paths.root,
        ownerToken: "o",
      },
      project.ctx,
    );
    const { tui, on } = await setup(() => ({ kind: "thread", thread }), { height: 30 });
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("No conversation yet");
    });
    expect(tui.frame().split("\n")[0]).toMatch(/^ {20}╭─ROW-01 › #1 Backlog─+ ✕ ╮$/);
    expect(tui.frame()).toMatch(/Status\s+· pending/);
    const hints = on.onHints.mock.lastCall?.[0] ?? [];
    expect(hints.map((hint: { key: string }) => hint.key)).toEqual(["↑/↓", "pgup/pgdn", "home/end", "tab", "esc"]);
    expect(hints.at(-1)).toEqual({ key: "esc", description: "Thread list" });
    await tui.press(keys.tab);
    expect(on.onTab).toHaveBeenCalledWith(1);
    await tui.press(keys.escape);
    expect(on.onBack).toHaveBeenCalledOnce();
    await tui.click("✕");
    expect(on.onClose).toHaveBeenCalledOnce();
  });

  it("creates a Story and reports it", async () => {
    const { tui, on } = await setup(() => ({ kind: "new" }));
    await tui.type("Write the docs");
    await tui.press(keys.ctrl("s"));
    await vi.waitFor(() =>
      expect(on.onSaved).toHaveBeenCalledWith(expect.objectContaining({ title: "Write the docs" })),
    );
    expect(tui.toasts.list().map((t) => t.message)).toEqual(["Created ROW-02"]);
  });

  it("asks before it deletes the Story with ctrl+d and with the Delete Button, over its body", async () => {
    const { tui, on } = await setup((story) => ({ kind: "edit", story }));
    await tui.press(keys.ctrl("d"));
    expect(tui.frame()).toContain("Delete ROW-01 Login? You cannot undo this.");
    await tui.press("n");
    expect(tui.frame()).not.toContain("You cannot undo this.");
    await tui.click("Delete");
    expect(tui.frame()).toContain("You cannot undo this.");
    await tui.press("y");
    await settle(50);
    await vi.waitFor(() => expect(on.onDeleted).toHaveBeenCalledWith("ROW-01"));
    expect(await searchStories({}, project.ctx)).toEqual([]);
  });

  it("changes its width on a drag of its left edge, between STORY_SIDEBAR_MIN_WIDTH and maxWidth", async () => {
    const { tui, on } = await setup(() => ({ kind: "new" }));
    // The Story sidebar covers the columns 20 to 79. Its edge is its left border and the column before it.
    await tui.mouse("press", 19, 1);
    await tui.mouse("move", 10, 1);
    await tui.mouse("move", 70, 1);
    await tui.mouse("move", 0, 1);
    await tui.mouse("release", 0, 1);
    expect(on.onResize.mock.calls).toEqual([[70], [STORY_SIDEBAR_MIN_WIDTH], [80]]);
  });

  it("keeps its form while it is hidden", async () => {
    const { tui, props } = await setup(() => ({ kind: "new" }));
    await tui.type("Draft");
    await tui.rerender(
      <Box paddingLeft={20}>
        <StorySidebar {...props} shown={false} focused={false} />
      </Box>,
    );
    expect(tui.frame()).not.toContain("Draft");
    await tui.rerender(
      <Box paddingLeft={20}>
        <StorySidebar {...props} />
      </Box>,
    );
    expect(tui.frame()).toContain("Draft");
  });
});
