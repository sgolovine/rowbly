import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../../testing/index.js";
import type { ModalProps } from "../modal/index.js";
import { useModalFrame } from "./use-modal-frame.js";

afterEach(cleanup);

function Probe(props: Omit<ModalProps, "children">) {
  const frame = useModalFrame({ ...props, children: null });

  return (
    <Text>{`${frame.footer?.map((hint) => hint.key).join(",")}|${frame.info ? "info" : "strip"}|${frame.top}`}</Text>
  );
}

describe("useModalFrame", () => {
  it("gives a titled modal without hints an `esc` key and a Close Button", async () => {
    const tui = await renderTui(<Probe title="About" onClose={() => {}} />);

    expect(tui.frame()).toContain("esc|info|true");
  });

  it("keeps the hint strip of a modal with its own hints", async () => {
    const tui = await renderTui(<Probe title="Story" hints={[{ key: "d", description: "delete" }]} />);

    expect(tui.frame()).toContain("d|strip|true");
  });

  it("is not the top layer when it is not focused", async () => {
    const tui = await renderTui(<Probe focused={false} />);

    expect(tui.frame()).toContain("undefined|strip|false");
  });
});
