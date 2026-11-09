import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { keys, renderTui } from "../../testing/index.js";
import { StoryFinder } from "./StoryFinder.js";

afterEach(cleanup);

const stages: Stage[] = [
  { key: "BACKLOG", label: "Backlog", enabled: true, prompt: "", position: 1 },
  { key: "DONE", label: "Done", enabled: true, prompt: "", position: 2 },
];
const story = (number: number, title: string, stage = "BACKLOG", description = ""): Story => ({
  id: `ROW-0${number}`,
  number,
  title,
  stage,
  position: number,
  description,
  fields: {},
  path: "",
});
const stories = [story(1, "Login page"), story(2, "Logout button", "DONE"), story(3, "Docs", "BACKLOG", "about login")];

function setup() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const tui = renderTui(<StoryFinder stories={stories} stages={stages} onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose, tui };
}

describe("StoryFinder", () => {
  it("lists every Story with its Stage", async () => {
    const frame = (await setup().tui).frame();
    expect(frame).toContain("Find Stories");
    expect(frame).toContain("3 Stories");
    expect(frame).toMatch(/▌ ROW-01 Login page · Backlog/);
    expect(frame).toContain("ROW-02 Logout button · Done");
  });

  it("matches the query fuzzily against the title, the Stage and the description", async () => {
    const t = await setup().tui;
    await t.type("lgi");
    expect(t.frame()).toContain("2 Stories");
    expect(t.frame()).toContain("Login page");
    expect(t.frame()).toContain("Docs");
    expect(t.frame()).not.toContain("Logout");
    await t.type(" zz");
    expect(t.frame()).toContain("No matching Stories.");
  });

  it("selects with the arrow keys and picks with enter or a click", async () => {
    const { tui, onSelect } = setup();
    const t = await tui;
    await t.press(keys.down, keys.enter);
    expect(onSelect).toHaveBeenLastCalledWith(stories[1]);
    await t.click("Docs");
    expect(onSelect).toHaveBeenLastCalledWith(stories[2]);
  });

  it("closes on esc", async () => {
    const { tui, onClose } = setup();
    await (await tui).press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
