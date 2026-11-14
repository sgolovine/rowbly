import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../testing/index.js";
import { useModalLayers } from "./use-modal-layers.js";

afterEach(cleanup);

function Probe({ layers, forms }: { layers: number; forms: number }) {
  const state = useModalLayers();
  const { registerLayer, registerForm } = state;

  useEffect(() => {
    const done = [
      ...Array.from({ length: layers }, () => registerLayer()),
      ...Array.from({ length: forms }, (_, i) => registerForm([{ key: `k${i}`, description: "form" }])),
    ];
    return () => {
      for (const release of done) release();
    };
  }, [layers, forms, registerLayer, registerForm]);

  return (
    <Text>{`covered:${state.covered} leads:${state.leads.flatMap((lead) => lead.keys.map((k) => k.key)).join(",")}`}</Text>
  );
}

describe("useModalLayers", () => {
  it("counts the layers and collects the Form keys until they are released", async () => {
    const tui = await renderTui(<Probe layers={0} forms={0} />);
    expect(tui.frame()).toContain("covered:false leads:");
    await tui.rerender(<Probe layers={1} forms={2} />);
    expect(tui.frame()).toContain("covered:true leads:k0,k1");
    await tui.rerender(<Probe layers={0} forms={0} />);
    expect(tui.frame()).toContain("covered:false leads:");
  });
});
