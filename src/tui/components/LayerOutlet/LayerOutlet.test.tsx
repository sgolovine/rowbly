import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui, settle } from "../../testing/index.js";
import { createLayerHost } from "../modalLayer.js";
import { LayerOutlet } from "./LayerOutlet.js";

afterEach(cleanup);

describe("LayerOutlet", () => {
  it("draws nothing with no layers", async () => {
    const tui = await renderTui(<LayerOutlet host={createLayerHost()} />);
    expect(tui.frame()).toBe("");
  });

  it("draws the layers in the order they opened, and follows show and hide", async () => {
    const host = createLayerHost();
    const tui = await renderTui(<LayerOutlet host={host} />);
    host.show("a", <Text>first</Text>);
    host.show("b", <Text>second</Text>);
    await settle();
    expect(tui.frame()).toBe("first\nsecond");
    host.show("a", <Text>FIRST</Text>);
    host.hide("b");
    await settle();
    expect(tui.frame()).toBe("FIRST");
  });
});
