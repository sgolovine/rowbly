import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initProject } from "../../../services/project/project.js";
import type { Story } from "../../../services/story/story.js";
import { useTempDir } from "../../../services/test-project/test-project.js";
import { storyListRows } from "../../screens/stories/index.js";
import { renderTui } from "../../testing/index.js";
import { StoryPanel, type StoryPanelBody } from "./story-panel.js";

afterEach(cleanup);

const STORY = { id: "ROW-01", number: 1, title: "First story", stage: "BACKLOG", position: 1 } as Story;

function boardBody(status: "ok" | "incomplete"): StoryPanelBody {
  return {
    kind: "board",
    activity: { path: "/p/state.json", status, message: "no stage", stories: {} },
    statusLine: status !== "ok",
    list: {
      rows: storyListRows([], [STORY]),
      cursor: 0,
      clickable: true,
      emptyText: "No Stories yet.",
      onCursor: () => {},
    },
  };
}

function panel(body: StoryPanelBody, onClick?: () => void) {
  return (
    <StoryPanel
      title="Rowbly › All Stages"
      focused
      height={undefined}
      inner={{ width: 80 }}
      onClick={onClick}
      body={body}
    />
  );
}

describe("StoryPanel", () => {
  const dir = useTempDir();

  it("shows the first load and a read error", async () => {
    const tui = await renderTui(panel({ kind: "loading" }));

    expect(tui.frame()).toContain("Loading Stories…");
    await tui.rerender(panel({ kind: "error" }));
    expect(tui.frame()).toContain("Rowbly could not read the project.");
  });

  it("shows the Stories, and a line for a problem with the factory state file", async () => {
    const tui = await renderTui(panel(boardBody("ok")));

    expect(tui.frame()).toContain("Rowbly › All Stages");
    expect(tui.frame()).toContain("First story");
    expect(tui.frame()).not.toContain("Factory activity");
    await tui.rerender(panel(boardBody("incomplete")));
    expect(tui.frame()).toContain("! Factory activity is incomplete");
  });

  it("shows the onboarding steps without a Project", async () => {
    const tui = await renderTui(
      panel({ kind: "onboarding", ctx: { cwd: dir.path }, active: true, onHints: () => {}, onCreated: () => {} }),
    );

    await vi.waitFor(() => expect(tui.frame()).toContain("Use defaults"));
  });

  it("shows the Factory view in threads mode", async () => {
    await initProject({ name: "Rowbly", key: "ROW" }, { cwd: dir.path });
    const tui = await renderTui(
      panel({
        kind: "threads",
        view: {
          ctx: { cwd: dir.path },
          root: dir.path,
          stage: undefined,
          stages: {},
          active: true,
          clickable: true,
          emptyText: "No Threads. The factory adds a Thread when it starts a worker.",
          onOpen: () => {},
          onHints: () => {},
        },
      }),
    );

    await vi.waitFor(() => expect(tui.frame()).toContain("The factory adds a Thread when it starts a worker."));
  });

  it("calls onClick on a click in the Panel", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(panel({ kind: "error" }, onClick));

    await tui.click("could not read");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
