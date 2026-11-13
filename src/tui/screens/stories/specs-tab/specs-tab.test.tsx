import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateProject } from "../../../../services/project/project.js";
import { createSpec, getSpec, listSpecs } from "../../../../services/spec/spec.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui } from "../../../testing/index.js";
import { SpecsTab } from "./specs-tab.js";

afterEach(cleanup);

type Tui = Awaited<ReturnType<typeof renderTui>>;

describe("SpecsTab", () => {
  const project = useTestProject();

  beforeEach(async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
    await createStory({ title: "Logout" }, project.ctx);
  });

  async function setup() {
    const onCount = vi.fn();
    const tui = await renderTui(
      <SpecsTab
        ctx={project.ctx}
        storyId="ROW-01"
        selected
        onCount={onCount}
        onEditing={() => {}}
        onHints={() => {}}
      />,
    );
    await shown(tui, "+ New Spec");
    return { tui, onCount };
  }
  /** Waits until the screen shows `text`: the services run on real files, and take longer under load. */
  const shown = (tui: Tui, text: string) =>
    vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain(text);
    });
  const hidden = (tui: Tui, text: string) =>
    vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).not.toContain(text);
    });

  it("shows that a Story has no specs", async () => {
    const { tui, onCount } = await setup();
    await shown(tui, "No Specs");
    await vi.waitFor(() => expect(onCount).toHaveBeenLastCalledWith(0));
  });

  it("lists only the specs of the Story and shows the text of the selected spec", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "The API text" }, project.ctx);
    await createSpec({ title: "Design", stories: ["ROW-01", "ROW-02"], body: "The design text" }, project.ctx);
    await createSpec({ title: "Other", stories: ["ROW-02"] }, project.ctx);
    const { tui, onCount } = await setup();
    await shown(tui, "The API text");
    await vi.waitFor(() => expect(onCount).toHaveBeenLastCalledWith(2));
    expect(tui.frame()).not.toContain("Other");
    await tui.press(keys.down);
    expect(tui.frame()).toContain("The design text");
    expect(tui.frame()).toContain("design · ROW-01, ROW-02");
  });

  it("shows the list and the text in two Panels, and tells how to create the first spec", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toMatch(/╭─Specs─+╮\s*╭─Spec─+╮/);
    expect(tui.frame()).toContain("Press n to create a Spec.");
  });

  it("titles the text Panel with the selected spec", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "One" }, project.ctx);
    const { tui } = await setup();
    expect(tui.frame()).toMatch(/╭─Specs─+╮\s*╭─API─+╮/);
  });

  it("moves the focus between the Panels on a click", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "One" }, project.ctx);
    await createSpec({ title: "Design", stories: ["ROW-01"], body: "Two" }, project.ctx);
    const { tui } = await setup();
    await tui.click("api · ROW-01");
    await tui.type("!");
    expect(tui.frame()).toContain("API *");
    await tui.click("Specs");
    await tui.press(keys.down);
    expect(tui.frame()).toContain("Two");
  });

  it("switches between the list and the text with tab", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "One" }, project.ctx);
    await createSpec({ title: "Design", stories: ["ROW-01"], body: "Two" }, project.ctx);
    const { tui } = await setup();
    await tui.press(keys.tab);
    await tui.type("!");
    expect(tui.frame()).toContain("API *");
    await tui.press(keys.tab);
    await tui.press(keys.down);
    expect(tui.frame()).toContain("Two");
  });

  it("creates a spec with n, links it to the Story and opens its text", async () => {
    const { tui } = await setup();
    await tui.press("n");
    await tui.type("Login page");
    await tui.press(keys.ctrl("s"));
    await shown(tui, "login-page · ROW-01");
    expect(await getSpec({ slug: "login-page" }, project.ctx)).toMatchObject({ stories: ["ROW-01"] });
    await tui.type("# Scope");
    await tui.press(keys.ctrl("s"));
    await hidden(tui, "Login page *");
    expect((await getSpec({ slug: "login-page" }, project.ctx)).body).toBe("# Scope");
  });

  it("creates a spec with enter, and shows that key in the New Spec Modal", async () => {
    const { tui } = await setup();
    await tui.press("n");
    expect(tui.frame()).toContain("enter/ctrl+s save");
    await tui.type("Login page");
    await tui.press(keys.enter);
    await shown(tui, "login-page · ROW-01");
    expect(await getSpec({ slug: "login-page" }, project.ctx)).toMatchObject({ stories: ["ROW-01"] });
  });

  it("keeps the New Spec Modal open when enter is pressed with no title", async () => {
    const { tui } = await setup();
    await tui.press("n");
    await tui.press(keys.enter);
    await shown(tui, "! required");
    expect(await listSpecs({ story: "ROW-01" }, project.ctx)).toEqual([]);
  });

  it("saves the text automatically, without ctrl+s", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "One" }, project.ctx);
    const { tui } = await setup();
    await tui.press(keys.enter);
    await tui.type("!");
    expect(tui.frame()).toContain("API *");
    await vi.waitFor(async () => expect((await getSpec({ slug: "api" }, project.ctx)).body).toContain("!"));
    await hidden(tui, "API *");
    expect(tui.frame()).toContain("!");
  });

  it("writes the text that is not saved yet when it unmounts", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "One" }, project.ctx);
    const { tui } = await setup();
    await tui.press(keys.enter);
    await tui.type("!");
    tui.unmount();
    await vi.waitFor(async () => expect((await getSpec({ slug: "api" }, project.ctx)).body).toContain("!"));
  });

  it("keeps the text of a spec when the selection moves", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "One" }, project.ctx);
    await createSpec({ title: "Design", stories: ["ROW-01"], body: "Two" }, project.ctx);
    const { tui } = await setup();
    await tui.press(keys.enter);
    await tui.type("!");
    await tui.press(keys.escape, keys.down);
    expect(tui.frame()).toContain("Two");
    await tui.press(keys.up);
    await shown(tui, "!");
  });

  it("selects another spec with a click during an edit, and then the list takes the keys", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"], body: "One" }, project.ctx);
    await createSpec({ title: "Design", stories: ["ROW-01"], body: "Two" }, project.ctx);
    await createSpec({ title: "Notes", stories: ["ROW-01"], body: "Three" }, project.ctx);
    const { tui } = await setup();
    await tui.press(keys.enter);
    await tui.press(keys.ctrl("s"));
    await tui.click("Design");
    expect(tui.frame()).toContain("Two");
    await tui.press(keys.down);
    expect(tui.frame()).toContain("Three");
  });

  it("closes the New Spec Modal with esc", async () => {
    const { tui } = await setup();
    await tui.press("n");
    expect(tui.frame()).toContain("New Spec");
    await tui.press(keys.escape);
    await hidden(tui, "Title");
    expect(tui.frame()).toContain("No Specs");
  });

  it("renames a spec with r", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"] }, project.ctx);
    const { tui } = await setup();
    await tui.press("r");
    expect(tui.frame()).toContain("Rename Spec › API");
    await tui.type(" v2");
    await tui.press(keys.ctrl("s"));
    await shown(tui, "API v2");
    expect((await getSpec({ slug: "api" }, project.ctx)).title).toBe("API v2");
  });

  it("deletes a spec of this Story alone after a confirmation", async () => {
    await createSpec({ title: "API", stories: ["ROW-01"] }, project.ctx);
    const { tui } = await setup();
    await tui.press("d");
    expect(tui.frame()).toContain("Delete API? You cannot undo this.");
    await tui.press("y");
    await shown(tui, "No Specs");
    expect(await listSpecs({}, project.ctx)).toEqual([]);
  });

  it("only removes a shared spec from this Story", async () => {
    await createSpec({ title: "API", stories: ["ROW-01", "ROW-02"] }, project.ctx);
    const { tui } = await setup();
    await tui.press("d");
    expect(tui.frame()).toMatch(/Remove API from ROW-01\? It stays linked to/);
    await tui.press("y");
    await shown(tui, "No Specs");
    expect((await getSpec({ slug: "api" }, project.ctx)).stories).toEqual(["ROW-02"]);
  });
});
