import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as attachment from "../../../../services/attachment/attachment.js";
import { createToastStore } from "../../../hooks/index.js";
import { type AttachmentsTabEnv, confirmRemove, handleKey, openItem } from "./attachments-tab-actions.js";

vi.mock("../../../../services/attachment/attachment.js", async (original) => ({
  ...(await original<object>()),
  openAttachment: vi.fn(async () => ({ opened: "test" })),
  removeAttachment: vi.fn(async () => {}),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const item: attachment.Attachment = {
  id: "a1",
  name: "one.png",
  type: "image/png",
  size: 8,
  createdAt: "2026-11-12T10:00:00.000Z",
};
const noKey = {} as Key;

function env(overrides: Partial<AttachmentsTabEnv> = {}): AttachmentsTabEnv {
  return {
    ctx: { cwd: "/p" },
    storyId: "ROW-01",
    toast: createToastStore(),
    count: 1,
    item,
    setTask: vi.fn(),
    setCursor: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

describe("handleKey", () => {
  it("asks for a path with n, and asks before a removal with d only for a selected image", () => {
    const tab = env();
    handleKey(tab, "n", noKey);
    handleKey(tab, "d", noKey);
    expect(vi.mocked(tab.setTask).mock.calls).toEqual([["path"], ["remove"]]);
    const empty = env({ item: undefined, count: 0 });
    handleKey(empty, "d", noKey);
    expect(empty.setTask).not.toHaveBeenCalled();
  });

  it("moves the selection with the arrows, inside the list", () => {
    const tab = env({ count: 3 });
    handleKey(tab, "", { ...noKey, downArrow: true });
    const move = vi.mocked(tab.setCursor).mock.calls[0]?.[0] as (n: number) => number;
    expect([move(0), move(2)]).toEqual([1, 2]);
  });
});

describe("openItem and confirmRemove", () => {
  it("opens the selected image, and does nothing without one", () => {
    openItem(env());
    openItem(env({ item: undefined }));
    expect(attachment.openAttachment).toHaveBeenCalledOnce();
    expect(attachment.openAttachment).toHaveBeenCalledWith({ story: "ROW-01", id: "a1" }, { cwd: "/p" });
  });

  it("closes the question, removes the image and reads the list again", async () => {
    const tab = env();
    confirmRemove(tab, item);
    expect(tab.setTask).toHaveBeenCalledWith(null);
    await vi.waitFor(() => expect(tab.reload).toHaveBeenCalledOnce());
    expect(attachment.removeAttachment).toHaveBeenCalledWith({ story: "ROW-01", id: "a1" }, { cwd: "/p" });
  });
});
