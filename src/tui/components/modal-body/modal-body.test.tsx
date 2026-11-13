import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { useContext } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayout } from "../../hooks/index.js";
import { renderTui } from "../../testing/index.js";
import { CoveredContext, createLayerHost } from "../modal-layer.js";
import { ModalBody } from "./modal-body.js";

afterEach(cleanup);

function Probe() {
  const layout = useLayout();
  const covered = useContext(CoveredContext);

  return <Text>{`${layout.width}x${layout.height}|${covered ? "covered" : "open"}`}</Text>;
}

describe("ModalBody", () => {
  it("gives the content the layout of the body and whether a task covers it", async () => {
    const tui = await renderTui(
      <ModalBody
        layout={{ width: 30, height: 4 }}
        flush
        scroll={false}
        covered
        host={createLayerHost()}
        registerLayer={vi.fn()}
        registerForm={vi.fn()}
        layers={<Text>layer</Text>}
      >
        <Probe />
      </ModalBody>,
    );

    expect(tui.frame()).toContain("30x4|covered");
    expect(tui.frame()).toContain("layer");
  });
});
