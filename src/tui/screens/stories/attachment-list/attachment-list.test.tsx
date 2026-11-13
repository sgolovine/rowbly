import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../../services/attachment/attachment.js";
import { renderTui } from "../../../testing/index.js";
import { AttachmentList } from "./attachment-list.js";

afterEach(cleanup);

const items: Attachment[] = [
  { id: "a1", name: "one.png", type: "image/png", size: 8, createdAt: "2026-11-12T10:00:00.000Z" },
  { id: "a2", name: "two.png", type: "image/png", size: 16, createdAt: "2026-11-12T11:00:00.000Z" },
];

describe("AttachmentList", () => {
  it("shows each image with its size, and selects an image on a click", async () => {
    const onSelect = vi.fn();
    const tui = await renderTui(
      <AttachmentList items={items} item={items[0]} active loading={false} height={undefined} onSelect={onSelect} />,
    );
    expect(tui.frame()).toContain("one.png · 8 bytes");
    expect(tui.frame()).toContain("two.png · 16 bytes");
    await tui.click("two.png");
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("tells how to add an image, or that the list loads", async () => {
    const empty = await renderTui(
      <AttachmentList items={[]} item={undefined} active loading={false} height={undefined} onSelect={vi.fn()} />,
    );
    expect(empty.frame()).toContain("No attachments. Paste an image or press n to add a PNG file.");
    cleanup();
    const loading = await renderTui(
      <AttachmentList items={[]} item={undefined} active loading height={undefined} onSelect={vi.fn()} />,
    );
    expect(loading.frame()).toContain("Loading attachments…");
  });
});
