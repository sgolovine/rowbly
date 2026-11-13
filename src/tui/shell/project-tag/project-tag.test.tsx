import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import { ProjectTag } from "./project-tag.js";

afterEach(cleanup);

describe("ProjectTag", () => {
  it("marks the open Project as current, also when it is missing", async () => {
    const tui = await renderTui(<ProjectTag project={{ path: "/a", name: "A", missing: true }} current="/a" />);
    expect(tui.frame()).toBe(" · current");
  });

  it("marks a missing Project", async () => {
    const tui = await renderTui(<ProjectTag project={{ path: "/b", name: "B", missing: true }} current="/a" />);
    expect(tui.frame()).toBe(" · missing");
  });

  it("shows nothing for a Project that is present and not open", async () => {
    const tui = await renderTui(<ProjectTag project={{ path: "/b", name: "B", missing: false }} current="/a" />);
    expect(tui.frame()).toBe("");
  });
});
