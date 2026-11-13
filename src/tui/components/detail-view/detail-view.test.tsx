import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { DetailView, markdownToPlain } from "./detail-view.js";

afterEach(cleanup);

describe("DetailView", () => {
  it("aligns the values after the longest label", async () => {
    const tui = await renderTui(
      <DetailView
        rows={[
          { label: "Stage", value: "Backlog" },
          { label: "Priority", value: 3 },
        ]}
      />,
    );
    const lines = tui.frame().split("\n");
    expect(lines[0]).toBe("Stage     Backlog");
    expect(lines[1]).toBe("Priority  3");
  });

  it("shows a dash for an empty value and renders a node value as it is", async () => {
    const tui = await renderTui(
      <DetailView
        rows={[
          { label: "Owner", value: "" },
          { label: "Link", value: <Text>custom node</Text> },
        ]}
      />,
    );
    expect(tui.frame()).toContain("Owner  —");
    expect(tui.frame()).toContain("Link   custom node");
  });

  it("shows the body as plain text below the rows, and no body when it is blank", async () => {
    const tui = await renderTui(<DetailView rows={[{ label: "Stage", value: "Done" }]} body={"# Notes\n**bold**"} />);
    expect(tui.frame()).toBe("Stage  Done\n\nNotes\nbold");
    await tui.rerender(<DetailView rows={[{ label: "Stage", value: "Done" }]} body={"  \n"} />);
    expect(tui.frame()).toBe("Stage  Done");
  });
});

describe("markdownToPlain", () => {
  it("drops heading marks, emphasis and code ticks", () => {
    expect(markdownToPlain("## Title\n**strong** __also__ `code`")).toBe("Title\nstrong also code");
  });

  it("shows link targets in brackets and turns list marks into bullets", () => {
    expect(markdownToPlain("[Docs](https://x.io) ![img](a.png)\n- one\n  * two")).toBe(
      "Docs (https://x.io) img (a.png)\n• one\n  • two",
    );
  });

  it("trims trailing whitespace", () => {
    expect(markdownToPlain("text\n\n  ")).toBe("text");
  });
});
