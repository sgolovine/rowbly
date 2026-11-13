import { Box } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { LayoutContext } from "../../hooks/index.js";
import { renderTui } from "../../testing/index.js";
import { Header } from "./header.js";

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

  describe("Factory Button", () => {
    const stopped = { version: 1, phase: "stopped" } as const;
    /** The full header at `width` columns, with a running factory or a stopped one. */
    const header = (width: number, onClick = () => {}) => (
      <LayoutContext.Provider value={{ width, height: undefined }}>
        <Box width={width}>
          <Header
            project={{ name: "rowbly", onClick: () => {} }}
            finder={{ onClick: () => {} }}
            factory={{ status: stopped, onClick }}
            settings={{ onClick: () => {} }}
            newStory={{ onClick: () => {}, showKey: true }}
            clickable
          />
        </Box>
      </LayoutContext.Provider>
    );

    it("shows the factory state with its key before Settings, and calls onClick on a click", async () => {
      const onClick = vi.fn();
      const tui = await renderTui(header(140, onClick));
      expect(tui.frame()).toMatch(/Factory off {2}f {2}\| {1,2}Settings {2},/);
      expect(tui.frame()).toContain("Find Stories");
      await tui.click("Factory");
      expect(onClick).toHaveBeenCalledOnce();
    });

    it("keeps the Project Button and + New Story at narrow widths, and drops the Factory key cap first", async () => {
      const tui = await renderTui(header(80));
      expect(tui.frame()).toContain("rowbly");
      expect(tui.frame()).toContain("+ New Story");
      expect(tui.frame()).toContain("Factory off");
      for (const width of [70, 60, 50]) {
        await tui.rerender(header(width));
        expect(tui.frame()).toContain("rowbly");
        expect(tui.frame()).toContain("+ New Story");
        // A row that does not fit wraps, and the Panel grows taller than three rows.
        expect(tui.frame().split("\n")).toHaveLength(3);
      }
      expect(tui.frame()).not.toContain("Factory");
    });

    it("leaves out the pending count of a running factory before it drops the Button", async () => {
      const running = {
        version: 1,
        phase: "ready",
        liveness: "alive",
        workers: { running: 2, pending: 1, waiting: 0, limit: 3 },
      } as FactoryStatus;
      const tui = await renderTui(
        <LayoutContext.Provider value={{ width: 80, height: undefined }}>
          <Box width={80}>
            <Header
              project={{ name: "Shop", onClick: () => {} }}
              finder={{ onClick: () => {} }}
              factory={{ status: running, onClick: () => {} }}
              settings={{ onClick: () => {} }}
              newStory={{ onClick: () => {}, showKey: true }}
              clickable
            />
          </Box>
        </LayoutContext.Provider>,
      );
      expect(tui.frame()).toMatch(/Factory 2\/3 {2}f/);
      expect(tui.frame()).not.toContain("pending");
    });
  });
});
