import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Spec } from "../../../../services/spec/spec.js";
import { renderTui } from "../../../testing/index.js";
import { SpecPanel, type SpecPanelProps } from "./spec-panel.js";

afterEach(cleanup);

const api: Spec = { slug: "api", title: "API", stories: ["ROW-01", "ROW-02"], body: "", path: "/p/api.md" };

function props(overrides: Partial<SpecPanelProps>): SpecPanelProps {
  return {
    current: api,
    text: "The API text",
    height: undefined,
    editorWidth: 60,
    editorRows: 5,
    listing: true,
    editing: false,
    onFocusEditor: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("SpecPanel", () => {
  it("shows the slug, the Stories and the text of the spec, and edits it on a click", async () => {
    const onFocusEditor = vi.fn();
    const tui = await renderTui(<SpecPanel {...props({ onFocusEditor })} />);
    expect(tui.frame()).toContain("api · ROW-01, ROW-02");
    expect(tui.frame()).toContain("The API text");
    await tui.click("The API text");
    expect(onFocusEditor).toHaveBeenCalled();
  });

  it("gives the spec with the new text while it edits", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<SpecPanel {...props({ text: "", listing: false, editing: true, onChange })} />);
    await tui.type("x");
    expect(onChange).toHaveBeenCalledWith(api, "x");
  });

  it("tells how to create a spec without a spec", async () => {
    const tui = await renderTui(<SpecPanel {...props({ current: undefined })} />);
    expect(tui.frame()).toContain("Press n to create a Spec.");
  });
});
