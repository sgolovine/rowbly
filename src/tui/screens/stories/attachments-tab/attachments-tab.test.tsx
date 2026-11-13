import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAttachments, openAttachment } from "../../../../services/attachment/attachment.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui } from "../../../testing/index.js";
import { AttachmentsTab } from "./attachments-tab.js";

vi.mock("../../../../services/attachment/attachment.js", async (original) => ({
  ...(await original<object>()),
  openAttachment: vi.fn(async () => ({ opened: "test" })),
}));
afterEach(cleanup);
describe("AttachmentsTab", () => {
  const p = useTestProject();
  it("adds a local file, selects by mouse and keyboard, opens, and confirms removal", async () => {
    await createStory({ title: "Files" }, p.ctx);
    const file = join(p.paths.root, "picture.png");
    await writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const onHints = vi.fn();
    const tui = await renderTui(
      <AttachmentsTab ctx={p.ctx} storyId="ROW-01" selected onHints={onHints} onTask={() => {}} />,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("No attachments");
    });
    expect(onHints.mock.lastCall?.[0].map((h: { key: string }) => h.key)).toEqual(["↑/↓", "n", "o", "d"]);
    await tui.press("n");
    await tui.type(file);
    await tui.press(keys.enter);
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("picture.png · 8 bytes");
    });
    await tui.click("picture.png");
    await tui.press(keys.down, "o");
    expect(openAttachment).toHaveBeenCalled();
    await tui.press("d");
    expect(tui.frame()).toContain("Remove picture.png?");
    await tui.press("n");
    expect(await listAttachments({ story: "1" }, p.ctx)).toHaveLength(1);
    await tui.click("Remove");
    expect(tui.frame()).toContain("Remove picture.png?");
    await tui.press("y");
    await vi.waitFor(async () => {
      await tui.press();
      expect(await listAttachments({ story: "1" }, p.ctx)).toEqual([]);
      expect(tui.frame()).toContain("No attachments");
    });
  });
});

describe("attachment viewport", () => {
  const p = useTestProject();
  it("keeps keyboard selection visible in a short viewport", async () => {
    const { LayoutContext } = await import("../../../hooks/index.js");
    await createStory(
      {
        title: "Many images",
        attachments: Array.from({ length: 12 }, (_, i) => ({
          name: `image-${i + 1}.png`,
          bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        })),
      },
      p.ctx,
    );
    const tui = await renderTui(
      <LayoutContext.Provider value={{ width: 80, height: 6 }}>
        <AttachmentsTab ctx={p.ctx} storyId="ROW-01" selected onHints={() => {}} onTask={() => {}} />
      </LayoutContext.Provider>,
    );
    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("image-1.png");
    });
    for (let i = 0; i < 11; i++) await tui.press(keys.down);
    expect(tui.frame()).toContain("image-12.png");
    expect(tui.frame()).toContain("New PNG");
    expect(tui.frame()).toContain("pgup/pgdn scroll");
  });
});
