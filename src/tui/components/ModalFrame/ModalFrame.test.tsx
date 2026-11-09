import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { useContext, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ActiveContext } from "../../hooks/index.js";
import { renderTui } from "../../testing/index.js";
import { FormKeysContext, ModalLayerContext } from "../modalLayer.js";
import { ModalFrame } from "./ModalFrame.js";

afterEach(cleanup);

/** Registers form keys in the enclosing frame, as a Form does. */
function FormKeys() {
  const register = useContext(FormKeysContext);
  useEffect(() => register?.([{ key: "ctrl+s", description: "save" }]), [register]);
  return <Text>form</Text>;
}

/** Opens a layer over the enclosing frame, as a nested Modal does. */
function Layer() {
  const register = useContext(ModalLayerContext);
  useEffect(() => register?.(), [register]);
  return null;
}

describe("ModalFrame", () => {
  it("draws the title, the body and the hint strip", async () => {
    const tui = await renderTui(
      <ModalFrame title="Story" hints={[{ key: "d", description: "delete" }]}>
        <Text>Body</Text>
      </ModalFrame>,
    );
    expect(tui.frame().split("\n")[0]).toMatch(/^╭─Story─+╮/);
    expect(tui.frame()).toContain("Body");
    expect(tui.frame()).toContain("d delete");
  });

  it("shows no hint strip without a title or hints", async () => {
    const tui = await renderTui(
      <ModalFrame>
        <Text>Body</Text>
      </ModalFrame>,
    );
    expect(tui.frame()).not.toContain("esc");
  });

  it("puts the form keys first and makes esc cancel", async () => {
    const tui = await renderTui(
      <ModalFrame title="New story" hints={[{ key: "x", description: "extra" }]}>
        <FormKeys />
      </ModalFrame>,
    );
    expect(tui.frame()).toMatch(/ctrl\+s save {2}x extra {2}esc cancel/);
  });

  it("goes quiet while a layer is open over it", async () => {
    const tui = await renderTui(
      <ModalFrame title="Story" hints={[{ key: "d", description: "delete" }]}>
        <Layer />
      </ModalFrame>,
    );
    expect(tui.frame()).not.toContain("d delete");
  });

  it("shows no ✕ and no keys while not active", async () => {
    const tui = await renderTui(
      <ActiveContext.Provider value={false}>
        <ModalFrame title="Story" hints={[{ key: "d", description: "delete" }]} onClose={() => {}}>
          <Text>Body</Text>
        </ModalFrame>
      </ActiveContext.Provider>,
    );
    expect(tui.frame()).not.toContain("✕");
    expect(tui.frame()).not.toContain("d delete");
  });
});
