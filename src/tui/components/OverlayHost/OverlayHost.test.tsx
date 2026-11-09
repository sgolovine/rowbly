import { Box, Text, useInput } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { useIsActive, useLayout, useMainOverlay } from "../../hooks/index.js";
import { renderTui } from "../../testing/index.js";

afterEach(cleanup);

function Overlay({ onClose }: { onClose(): void }) {
  const { height } = useLayout();
  useInput((input) => {
    if (input === "c") onClose();
  });
  return <Text>{`overlay open, height ${height ?? "none"}`}</Text>;
}

/** `o` opens a main overlay; the line shows whether this child takes keys. */
function Opener() {
  const overlay = useMainOverlay();
  const active = useIsActive();
  useInput(
    (input) => {
      if (input === "o") overlay?.open("opener", <Overlay onClose={() => overlay.close("opener")} />);
    },
    { isActive: active },
  );
  return (
    <Box height={12}>
      <Text>{active ? "child active" : "child inactive"}</Text>
    </Box>
  );
}

describe("OverlayHost", () => {
  it("shows a main overlay, makes the children inactive, and closes it", async () => {
    const tui = await renderTui(<Opener />);
    expect(tui.frame()).toContain("child active");
    await tui.press("o");
    expect(tui.frame()).toContain("overlay open");
    expect(tui.frame()).toContain("child inactive");
    await tui.press("c");
    expect(tui.frame()).not.toContain("overlay open");
    expect(tui.frame()).toContain("child active");
  });

  it("gives a main overlay no height outside full screen", async () => {
    const tui = await renderTui(<Opener />);
    await tui.press("o");
    expect(tui.frame()).toContain("overlay open, height none");
  });
});
