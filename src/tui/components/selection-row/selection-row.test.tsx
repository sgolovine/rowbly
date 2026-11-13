import { Box, Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { ScrollFocusContext } from "../scroll-focus.js";
import { SelectionRow } from "./selection-row.js";

afterEach(cleanup);

describe("SelectionRow", () => {
  it("shows the marker only when selected", async () => {
    const tui = await renderTui(
      <SelectionRow selected active>
        <Text>Title</Text>
      </SelectionRow>,
    );
    expect(tui.frame()).toBe("▌ Title");
    await tui.rerender(
      <SelectionRow selected={false} active>
        <Text>Title</Text>
      </SelectionRow>,
    );
    expect(tui.frame()).toBe("  Title");
  });

  it("keeps the marker column at two cells when the content is wider than the row", async () => {
    const tui = await renderTui(
      <Box width={20} flexDirection="column">
        {["A".repeat(30), "B".repeat(6)].map((title) => (
          <SelectionRow key={title} selected={false} active>
            <Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end">{title}</Text>
              </Box>
              <Box flexShrink={0}>
                <Text>{"-".repeat(15)}</Text>
              </Box>
            </Box>
          </SelectionRow>
        ))}
      </Box>,
    );
    const [long, short] = tui.frame().split("\n");
    expect(long).toMatch(/^ {2}A/);
    expect(short).toMatch(/^ {2}B/);
  });

  it("calls onClick on a click while active, and not while inactive", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <SelectionRow selected={false} active onClick={onClick}>
        <Text>Title</Text>
      </SelectionRow>,
    );
    await tui.click("Title");
    await tui.rerender(
      <SelectionRow selected={false} active={false} onClick={onClick}>
        <Text>Title</Text>
      </SelectionRow>,
    );
    await tui.click("Title");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("carries its drag value to a row that it is dropped on", async () => {
    const onDrop = vi.fn();
    const onDragOver = vi.fn();
    const tui = await renderTui(
      <>
        <SelectionRow selected={false} active drag="first">
          <Text>First</Text>
        </SelectionRow>
        <SelectionRow selected={false} active onDrop={onDrop} onDragOver={onDragOver}>
          <Text>Second</Text>
        </SelectionRow>
      </>,
    );
    const from = tui.locate("First");
    const to = tui.locate("Second");
    await tui.mouse("press", from.x, from.y);
    await tui.mouse("move", to.x, to.y);
    expect(onDragOver.mock.calls[0]?.[0]).toBe("first");
    await tui.mouse("release", to.x, to.y);
    expect(onDrop.mock.calls[0]?.[0]).toBe("first");
    expect(tui.frame()).toContain("  Second");
  });

  it("scrolls itself into view while selected and active", async () => {
    const reveal = vi.fn();
    const row = (selected: boolean, active: boolean) => (
      <ScrollFocusContext.Provider value={reveal}>
        <SelectionRow selected={selected} active={active}>
          <Text>Title</Text>
        </SelectionRow>
      </ScrollFocusContext.Provider>
    );
    const tui = await renderTui(row(true, false));
    expect(reveal).not.toHaveBeenCalled();
    await tui.rerender(row(true, true));
    expect(reveal).toHaveBeenCalled();
  });
});
