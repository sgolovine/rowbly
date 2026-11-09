import { Box, type DOMElement, Text, useInput } from "ink";
import { cleanup } from "ink-testing-library";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastArea } from "./components/index.js";
import { useIsActive, useLayout, useMainOverlay, useMouse } from "./hooks/index.js";
import { renderTui, settle } from "./testing/index.js";

afterEach(cleanup);

/** Shows whether its part of the app takes keys; `o` opens the main overlay. */
function Probe({ onClick = () => {} }: { onClick?(): void }) {
  const active = useIsActive();
  const overlay = useMainOverlay();
  const { width } = useLayout();
  const button = useRef<DOMElement>(null);
  useMouse(button, { onClick });
  useInput(
    (input) => {
      if (input === "o") overlay?.open("probe", <Text>overlay open</Text>);
    },
    { isActive: active },
  );
  return (
    <Box height={8} flexDirection="column">
      <Text>{active ? "active" : "inactive"}</Text>
      <Text>width {width}</Text>
      <Box ref={button}>
        <Text>Rename</Text>
      </Box>
    </Box>
  );
}

describe("TuiProviders", () => {
  it("gives the toast store to the toast area", async () => {
    const tui = await renderTui(
      <Box height={6} width={100}>
        <ToastArea />
      </Box>,
    );
    tui.toasts.push("warning", "Disk is almost full");
    await settle();
    expect(tui.frame()).toContain("! Disk is almost full");
  });

  it("makes the children active and gives the terminal width as the layout", async () => {
    const tui = await renderTui(<Probe />);
    expect(tui.frame()).toContain("active");
    expect(tui.frame()).toContain("width 100");
  });

  it("shows a node opened with useMainOverlay over inactive children", async () => {
    const tui = await renderTui(<Probe />);
    await tui.press("o");
    expect(tui.frame()).toContain("overlay open");
    expect(tui.frame()).toContain("inactive");
  });

  it("feeds the mouse into the registry, so a click reaches a box", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<Probe onClick={onClick} />);
    await tui.click("Rename");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
