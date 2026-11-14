import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsActive } from "../../hooks/index.js";
import { keys, renderTui } from "../../testing/index.js";
import { ConfirmDialog } from "../confirm-dialog/index.js";
import { useCovered } from "../modal-layer.js";
import { useModalLayers } from "../use-modal-layers.js";
import { PaneBody } from "./pane-body.js";

afterEach(cleanup);

function Content({ onConfirm }: { onConfirm(): void }) {
  const [asking, setAsking] = useState(true);
  const covered = useCovered();
  const active = useIsActive();

  return (
    <>
      <Text>{`covered:${covered} active:${active}`}</Text>
      {asking && (
        <ConfirmDialog
          title="Delete"
          message="Delete it?"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={onConfirm}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}

function Pane({ onConfirm }: { onConfirm(): void }) {
  const layers = useModalLayers();
  return (
    <PaneBody layers={layers} layout={{ width: 60, height: undefined }} flush={false} scroll={false}>
      <Content onConfirm={onConfirm} />
    </PaneBody>
  );
}

describe("PaneBody", () => {
  it("shows a Modal of the content as a layer, and covers the content until it closes", async () => {
    const onConfirm = vi.fn();
    const tui = await renderTui(<Pane onConfirm={onConfirm} />);
    expect(tui.frame()).toContain("Delete it?");
    expect(tui.frame()).toContain("covered:true");
    await tui.press(keys.escape);
    expect(tui.frame()).not.toContain("Delete it?");
    expect(tui.frame()).toContain("covered:false");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
