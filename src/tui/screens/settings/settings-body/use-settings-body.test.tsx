import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import type { SettingsGroup } from "../settings-sections.js";
import { useSettingsBody } from "./use-settings-body.js";

afterEach(cleanup);

const Empty = () => null;
const GROUPS: SettingsGroup[] = [
  {
    title: "One",
    sections: [
      { id: "a", label: "A", description: "", Component: Empty },
      { id: "b", label: "B", description: "", Component: Empty },
    ],
  },
];

function Probe({ section, onClose }: { section?: string; onClose: () => void }) {
  const model = useSettingsBody({ groups: GROUPS, initialSection: section, onClose, onHints: () => {} });

  return (
    <Text>
      focus={model.focus} section={model.section?.id}
    </Text>
  );
}

describe("useSettingsBody", () => {
  it("moves in the list, wraps at the end, and opens a section with enter", async () => {
    const tui = await renderTui(<Probe onClose={vi.fn()} />);

    expect(tui.frame()).toContain("focus=nav section=a");

    await tui.press(keys.down);
    await tui.press(keys.down);

    expect(tui.frame()).toContain("section=a");

    await tui.press(keys.enter);

    expect(tui.frame()).toContain("focus=section");
  });

  it("opens with the focus on a known section, and esc goes back, then closes", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(<Probe section="b" onClose={onClose} />);

    expect(tui.frame()).toContain("focus=section section=b");

    await tui.press(keys.escape);

    expect(tui.frame()).toContain("focus=nav");
    expect(onClose).not.toHaveBeenCalled();

    await tui.press(keys.escape);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
