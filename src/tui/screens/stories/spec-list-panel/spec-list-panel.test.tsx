import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Spec } from "../../../../services/spec/spec.js";
import { renderTui } from "../../../testing/index.js";
import { SpecListPanel, type SpecListPanelProps } from "./spec-list-panel.js";

afterEach(cleanup);

const api: Spec = { slug: "api", title: "API", stories: ["ROW-01"], body: "", path: "/p/api.md" };
const design: Spec = { slug: "design", title: "Design", stories: ["ROW-01"], body: "", path: "/p/design.md" };

function props(overrides: Partial<SpecListPanelProps>): SpecListPanelProps {
  return {
    specs: [api, design],
    cursor: 0,
    width: 26,
    height: undefined,
    listing: true,
    editing: false,
    isUnsaved: () => false,
    onFocusList: vi.fn(),
    onClickRow: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  };
}

describe("SpecListPanel", () => {
  it("lists the specs, marks unsaved text, and gives the index of a clicked row", async () => {
    const onClickRow = vi.fn();
    const tui = await renderTui(
      <SpecListPanel {...props({ onClickRow, isUnsaved: (spec) => spec.slug === "design" })} />,
    );
    expect(tui.frame()).toContain("API");
    expect(tui.frame()).toContain("Design *");
    await tui.click("Design");
    expect(onClickRow).toHaveBeenCalledWith(1);
  });

  it("says when the Story has no specs, and creates a spec on a click of the button", async () => {
    const onNew = vi.fn();
    const tui = await renderTui(<SpecListPanel {...props({ specs: [], onNew })} />);
    expect(tui.frame()).toContain("No Specs");
    await tui.click("+ New Spec");
    expect(onNew).toHaveBeenCalledOnce();
  });
});
