import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../../services/attachment/attachment.js";
import { readClipboardImage } from "../../services/clipboard/clipboard.js";
import { CoveredContext } from "../components/modalLayer.js";
import { keys, renderTui, settle } from "../testing/index.js";
import { ActiveContext } from "./shell.js";
import { useStoryPaste } from "./useStoryPaste.js";

vi.mock("../../services/clipboard/clipboard.js", async (original) => ({
  ...(await original<object>()),
  readClipboardImage: vi.fn(),
}));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function Host({ owner = "ROW-01" }: { owner?: string }) {
  const paste = useStoryPaste(owner);
  return <Text>{paste.summary ?? "No pending images"}</Text>;
}
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(readClipboardImage).mockReset().mockResolvedValue({ bytes: png, type: "image/png" });
});
describe("Story image paste ownership", () => {
  it.each([keys.ctrl("v"), "\u001bv", "\u001b\u0016", "\u001b[200~\u001b[201~"])(
    "reads an image for gesture %j",
    async (gesture) => {
      const tui = await renderTui(<Host />);
      await tui.press(gesture);
      await vi.waitFor(() => expect(tui.frame()).toContain("1 pending image"));
      expect(readClipboardImage).toHaveBeenCalledOnce();
      expect(tui.toasts.list().some((t) => t.message.includes("Image added"))).toBe(true);
    },
  );
  it("ignores text paste, covered screens, and inactive screens", async () => {
    const tui = await renderTui(<Host />);
    await tui.press("\u001b[200~normal text\u001b[201~");
    await tui.rerender(
      <CoveredContext.Provider value={true}>
        <Host />
      </CoveredContext.Provider>,
    );
    await tui.press(keys.ctrl("v"));
    await tui.rerender(
      <ActiveContext.Provider value={false}>
        <Host />
      </ActiveContext.Provider>,
    );
    await tui.press(keys.ctrl("v"));
    expect(readClipboardImage).not.toHaveBeenCalled();
  });
  it("keeps only one read in flight and discards its result when the owner changes", async () => {
    let finish!: (value: { bytes: Uint8Array; type: "image/png" }) => void;
    vi.mocked(readClipboardImage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const tui = await renderTui(<Host />);
    await tui.press(keys.ctrl("v"), keys.ctrl("v"));
    expect(readClipboardImage).toHaveBeenCalledOnce();
    expect(tui.toasts.list().some((t) => t.pending)).toBe(true);
    await tui.rerender(<Host owner="ROW-02" />);
    finish({ bytes: png, type: "image/png" });
    await settle(50);
    expect(tui.frame()).toContain("No pending images");
    expect(tui.toasts.list()).toEqual([]);
  });
  it("discards a read when its screen closes and prevents a read on the next Story until it finishes", async () => {
    let finish!: (value: { bytes: Uint8Array; type: "image/png" }) => void;
    vi.mocked(readClipboardImage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const tui = await renderTui(<Host />);
    await tui.press(keys.ctrl("v"));
    await tui.rerender(<Text>Closed</Text>);
    await tui.rerender(<Host owner="ROW-02" />);
    await tui.press(keys.ctrl("v"));
    expect(readClipboardImage).toHaveBeenCalledOnce();
    finish({ bytes: png, type: "image/png" });
    await settle(50);
    expect(tui.frame()).toContain("No pending images");
    await tui.press(keys.ctrl("v"));
    expect(tui.frame()).toContain("1 pending image");
  });
  it("limits the total pending bytes", async () => {
    const bytes = new Uint8Array(MAX_ATTACHMENT_BYTES);
    bytes.set(png);
    vi.mocked(readClipboardImage).mockResolvedValueOnce({ bytes, type: "image/png" });
    const tui = await renderTui(<Host />);
    await tui.press(keys.ctrl("v"), keys.ctrl("v"));
    expect(tui.frame()).toContain("1 pending image");
    expect(tui.toasts.list().some((t) => t.message.includes("exceed 10 MiB"))).toBe(true);
  });
});
