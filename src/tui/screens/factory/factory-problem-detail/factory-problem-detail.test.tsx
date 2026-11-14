import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Story } from "../../../../services/story/story.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { renderTui } from "../../../testing/index.js";
import type { FactoryProblem } from "../factory-status.js";
import { FactoryProblemDetail, type FactoryProblemDetailProps } from "./factory-problem-detail.js";

afterEach(cleanup);

const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

const commit: FactoryProblem = {
  key: "attention:commit",
  kind: "attention",
  title: "commit",
  text: `ROW-01: ${words}`,
  message: words,
  attentionKey: "commit",
  storyId: "ROW-01",
  dismissible: true,
};

function props(overrides: Partial<FactoryProblemDetailProps> = {}): FactoryProblemDetailProps {
  return {
    problem: commit,
    story: { id: "ROW-01", title: "Fix the commit" } as Story,
    thread: { id: "thread-1", status: "failed" } as ThreadRecord,
    can: { story: true, thread: true, dismiss: true },
    busy: false,
    clickable: true,
    onStory: vi.fn(),
    onThread: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

describe("FactoryProblemDetail", () => {
  it("shows the full text with wrap, the Story and the Thread", async () => {
    const tui = await renderTui(<FactoryProblemDetail {...props()} />);
    const frame = tui.frame();

    expect(words.length).toBeGreaterThan(100);
    expect(frame).toContain("word0");
    expect(frame).toContain("word39");
    expect(frame).not.toContain("…");
    expect(frame).toContain("Attention entry");
    expect(frame).toContain("ROW-01 · Fix the commit");
    expect(frame).toContain("thread-1 · failed");
  });

  it("runs the actions of its buttons", async () => {
    const p = props();
    const tui = await renderTui(<FactoryProblemDetail {...p} />);
    await tui.click("Story  o");
    await tui.click("Thread  t  ");
    await tui.click("Dismiss");

    expect(p.onStory).toHaveBeenCalledOnce();
    expect(p.onThread).toHaveBeenCalledOnce();
    expect(p.onDismiss).toHaveBeenCalledOnce();
  });

  it("shows the Story ID without an action when the board has no such Story", async () => {
    const tui = await renderTui(
      <FactoryProblemDetail
        {...props({ story: undefined, thread: undefined, can: { story: false, thread: false, dismiss: true } })}
      />,
    );

    expect(tui.frame()).toContain("ROW-01");
    expect(tui.frame()).not.toMatch(/Story\s+o/);
    expect(tui.frame()).toMatch(/Dismiss\s+d/);
  });

  it("shows the file and the message of a Thread file issue, without a Dismiss", async () => {
    const issue: FactoryProblem = {
      key: "issue:threads/x.json",
      kind: "issue",
      title: "Thread file",
      text: "threads/x.json: bad JSON",
      message: "bad JSON",
      file: "threads/x.json",
      dismissible: false,
    };
    const tui = await renderTui(
      <FactoryProblemDetail
        {...props({
          problem: issue,
          story: undefined,
          thread: undefined,
          can: { story: false, thread: false, dismiss: false },
        })}
      />,
    );

    expect(tui.frame()).toContain("bad JSON");
    expect(tui.frame()).toContain("threads/x.json");
    expect(tui.frame()).toContain("Thread file issue");
    expect(tui.frame()).not.toContain("Dismiss");
  });
});
