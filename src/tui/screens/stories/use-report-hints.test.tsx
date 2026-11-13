import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyHint } from "../../keymap.js";
import { renderTui } from "../../testing/index.js";
import { useReportHints } from "./use-report-hints.js";

afterEach(cleanup);

function Probe({ hints, onHints }: { hints: readonly KeyHint[]; onHints: (hints: readonly KeyHint[]) => void }) {
  useReportHints(onHints, hints);

  return <Text>probe</Text>;
}

describe("useReportHints", () => {
  it("reports the hints again only when their content changes", async () => {
    const onHints = vi.fn();
    const tui = await renderTui(<Probe hints={[{ key: "n", description: "new" }]} onHints={onHints} />);
    await tui.rerender(<Probe hints={[{ key: "n", description: "new" }]} onHints={onHints} />);
    expect(onHints).toHaveBeenCalledOnce();
    await tui.rerender(<Probe hints={[{ key: "d", description: "remove" }]} onHints={onHints} />);
    expect(onHints).toHaveBeenLastCalledWith([{ key: "d", description: "remove" }]);
    expect(onHints).toHaveBeenCalledTimes(2);
  });
});
