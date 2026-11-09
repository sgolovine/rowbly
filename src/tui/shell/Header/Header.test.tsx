import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { Header } from "./Header.js";

afterEach(cleanup);

describe("Header", () => {
  it("shows the finder on the left and + New Story with its key on the right", async () => {
    const tui = await renderTui(
      <Header finder={{ onClick: () => {} }} newStory={{ onClick: () => {}, showKey: true }} clickable />,
    );
    expect(tui.frame()).toMatch(/│ {2}🔎 Find Stories {3}ctrl\+p\s+\+ New Story {2}n {3}│/);
  });

  it("hides the n key while another region owns it, and shows neither control without a project", async () => {
    const tui = await renderTui(
      <Header finder={{ onClick: () => {} }} newStory={{ onClick: () => {}, showKey: false }} clickable />,
    );
    expect(tui.frame()).toMatch(/\+ New Story\s+│/);
    await tui.rerender(<Header clickable />);
    expect(tui.frame()).not.toContain("Find Stories");
    expect(tui.frame()).not.toContain("New Story");
  });

  it("shows Settings with its key before + New Story", async () => {
    const tui = await renderTui(
      <Header
        finder={{ onClick: () => {} }}
        settings={{ onClick: () => {} }}
        newStory={{ onClick: () => {}, showKey: true }}
        clickable
      />,
    );
    expect(tui.frame()).toMatch(/Settings {2}, {2}\| \+ New Story/);
  });

  it("shows the Project Button at the far left, before the finder", async () => {
    const tui = await renderTui(
      <Header project={{ name: "Rowbly", onClick: () => {} }} finder={{ onClick: () => {} }} clickable />,
    );
    expect(tui.frame()).toMatch(/│ {2}Rowbly {2}p {2}\| {2}\s*🔎 Find Stories/);
  });

  it("cuts a long Project name", async () => {
    const tui = await renderTui(<Header project={{ name: "A".repeat(40), onClick: () => {} }} clickable />);
    expect(tui.frame()).toContain(`${"A".repeat(23)}…`);
  });

  it("calls the Project Button on a click", async () => {
    const project = vi.fn();
    const tui = await renderTui(<Header project={{ name: "Rowbly", onClick: project }} clickable />);
    await tui.click("Rowbly");
    expect(project).toHaveBeenCalledOnce();
  });

  it("calls the controls on a click", async () => {
    const finder = vi.fn();
    const newStory = vi.fn();
    const settings = vi.fn();
    const tui = await renderTui(
      <Header
        finder={{ onClick: finder }}
        settings={{ onClick: settings }}
        newStory={{ onClick: newStory, showKey: true }}
        clickable
      />,
    );
    await tui.click("Find Stories");
    await tui.click("Settings");
    await tui.click("+ New Story");
    expect(finder).toHaveBeenCalledOnce();
    expect(settings).toHaveBeenCalledOnce();
    expect(newStory).toHaveBeenCalledOnce();
  });
});
