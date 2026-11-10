import { cleanup } from "ink-testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { readClipboardImage } from "../../../../services/clipboard/clipboard.js";
import { keys, renderTui } from "../../../testing/index.js";
import { NewStoryImages } from "./NewStoryImages.js";

vi.mock("../../../../services/clipboard/clipboard.js", async (original) => ({
  ...(await original<object>()),
  readClipboardImage: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("does not read the clipboard while disabled", async () => {
  const tui = await renderTui(<NewStoryImages onPaste={() => {}} enabled={false} />);
  await tui.press(keys.ctrl("v"));
  expect(readClipboardImage).not.toHaveBeenCalled();
});
it("shows the pending image count and byte size", async () => {
  vi.mocked(readClipboardImage).mockResolvedValue({
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    type: "image/png",
  });
  const onPaste = vi.fn();
  const tui = await renderTui(<NewStoryImages onPaste={onPaste} />);
  await tui.press(keys.ctrl("v"));
  expect(tui.frame()).toContain("1 pending image · 8 bytes");
  expect(onPaste.mock.lastCall?.[0].pending).toHaveLength(1);
});
