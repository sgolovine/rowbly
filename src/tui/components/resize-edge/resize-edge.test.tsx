import { Box, type DOMElement, Text } from "ink";
import { cleanup } from "ink-testing-library";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { pulledWidth, ResizeEdge } from "./resize-edge.js";

afterEach(cleanup);

describe("pulledWidth", () => {
  const bounds = { width: 20, minWidth: 10, maxWidth: 30 };

  it("puts the right border at the pointer", () => {
    expect(pulledWidth("right", 5, bounds, 29)).toBe(25);
  });

  it("puts the left border at the pointer, and keeps the right border", () => {
    // The box covers the columns 50 to 69.
    expect(pulledWidth("left", 50, bounds, 45)).toBe(25);
    expect(pulledWidth("left", 50, bounds, 55)).toBe(15);
  });

  it("keeps the width between the limits", () => {
    expect(pulledWidth("left", 50, bounds, 0)).toBe(30);
    expect(pulledWidth("left", 50, bounds, 69)).toBe(10);
    expect(pulledWidth("right", 5, bounds, 100)).toBe(30);
  });
});

/** A box of 20 columns at column 30, with the edge in its outer box, as `Sidebar` puts it. */
function Box20({ onResize, active = true }: { onResize(width: number): void; active?: boolean }) {
  const ref = useRef<DOMElement>(null);
  return (
    <Box paddingLeft={30}>
      <Box ref={ref} width={20} height={3}>
        <Box width={20} height={3} borderStyle="round">
          <Text>box</Text>
        </Box>
        <ResizeEdge
          target={ref}
          side="left"
          width={20}
          minWidth={10}
          maxWidth={40}
          active={active}
          onResize={onResize}
        />
      </Box>
    </Box>
  );
}

describe("ResizeEdge", () => {
  it("resizes the box on a pull of its left edge", async () => {
    const onResize = vi.fn();
    const tui = await renderTui(<Box20 onResize={onResize} />);
    await tui.mouse("press", 30, 1);
    await tui.mouse("move", 25, 1);
    await tui.mouse("move", 45, 1);
    await tui.mouse("release", 45, 1);
    expect(onResize.mock.calls).toEqual([[25], [10]]);
  });

  it("can be pulled at the gap before the border", async () => {
    const onResize = vi.fn();
    const tui = await renderTui(<Box20 onResize={onResize} />);
    await tui.mouse("press", 29, 1);
    await tui.mouse("move", 20, 1);
    await tui.mouse("release", 20, 1);
    expect(onResize.mock.calls).toEqual([[30]]);
  });

  it("ignores the mouse while not active", async () => {
    const onResize = vi.fn();
    const tui = await renderTui(<Box20 onResize={onResize} active={false} />);
    await tui.mouse("press", 30, 1);
    await tui.mouse("move", 25, 1);
    await tui.mouse("release", 25, 1);
    expect(onResize).not.toHaveBeenCalled();
  });
});
