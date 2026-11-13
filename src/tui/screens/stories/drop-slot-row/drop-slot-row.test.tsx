import { Box, Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionRow } from "../../../components/index.js";
import { renderTui } from "../../../testing/index.js";
import { DropSlotRow } from "./drop-slot-row.js";

afterEach(cleanup);

describe("DropSlotRow", () => {
  it("is one empty row that takes a drop", async () => {
    const onDrop = vi.fn();
    const onDragOver = vi.fn();
    const tui = await renderTui(
      <Box flexDirection="column">
        <SelectionRow selected={false} active drag="first">
          <Text>First</Text>
        </SelectionRow>
        <DropSlotRow clickable onDrop={onDrop} onDragOver={onDragOver} onDragLeave={() => {}} />
        <Text>Last</Text>
      </Box>,
    );
    expect(tui.frame()).toBe("  First\n\nLast");
    const from = tui.locate("First");
    await tui.mouse("press", from.x, from.y);
    await tui.mouse("move", 0, from.y + 1);
    expect(onDragOver.mock.calls[0]?.[0]).toBe("first");
    await tui.mouse("release", 0, from.y + 1);
    expect(onDrop.mock.calls[0]?.[0]).toBe("first");
  });
});
