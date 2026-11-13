import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import type { SettingsGroup } from "../settings-sections.js";
import { SectionNav } from "./section-nav.js";

afterEach(cleanup);

const Empty = () => null;
const GROUPS: SettingsGroup[] = [
  { title: "Project", sections: [{ id: "a", label: "General", description: "", Component: Empty }] },
  { title: "Maintenance", sections: [{ id: "b", label: "Doctor", description: "", Component: Empty }] },
];

describe("SectionNav", () => {
  it("shows the group headings and marks the selected section", async () => {
    const tui = await renderTui(<SectionNav groups={GROUPS} selected="b" clickable onSelect={() => {}} />);
    expect(tui.frame()).not.toContain("Sections");
    expect(tui.frame()).toMatch(/│ Project\s+│\n│ {3}General/);
    expect(tui.frame()).toContain("Maintenance");
    expect(tui.frame()).toContain("▌ Doctor");
  });

  it("selects a section on a click", async () => {
    const onSelect = vi.fn();
    const tui = await renderTui(<SectionNav groups={GROUPS} selected="a" clickable onSelect={onSelect} />);
    await tui.click("Doctor");
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("takes the focus on a click that no section takes", async () => {
    const onFocus = vi.fn();
    const onSelect = vi.fn();
    const tui = await renderTui(
      <SectionNav groups={GROUPS} selected="a" clickable onFocus={onFocus} onSelect={onSelect} />,
    );
    await tui.click("Maintenance");
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
