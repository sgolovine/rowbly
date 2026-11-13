import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import type { SelectListProps } from "./select-list-types.js";
import { useSelectList } from "./use-select-list.js";

afterEach(cleanup);

const ITEMS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", locked: true },
  { value: "c", label: "Gamma" },
];

function Probe(props: SelectListProps<string>) {
  const { env, filter } = useSelectList(props);

  return (
    <Text>{`${env.index}|${env.visible.map((item) => item.value).join("")}|${filter}|${env.selected.join("")}`}</Text>
  );
}

describe("useSelectList", () => {
  it("moves the highlight within the items and picks with enter", async () => {
    const onSelect = vi.fn();
    const tui = await renderTui(<Probe items={ITEMS} onSelect={onSelect} />);

    await tui.press("j", "j", "j", keys.enter);

    expect(tui.frame()).toContain("2|abc||");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("filters by label", async () => {
    const tui = await renderTui(<Probe items={ITEMS} />);

    await tui.press("/");

    expect(tui.frame()).toContain("0|abc||");
  });

  it("toggles the unlocked items in multi mode and submits them", async () => {
    const onSubmit = vi.fn();
    const tui = await renderTui(<Probe items={ITEMS} multi onSubmit={onSubmit} />);

    await tui.press(" ", "j", " ", "j", " ", keys.enter);

    expect(onSubmit).toHaveBeenCalledWith(["a", "c"]);
  });
});
