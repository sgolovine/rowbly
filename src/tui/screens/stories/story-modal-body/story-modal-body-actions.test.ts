import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";
import { handleBodyKey, type StoryModalBodyEnv, submitStory } from "./story-modal-body-actions.js";

const noKey = {} as Key;

function env(overrides: Partial<StoryModalBodyEnv> = {}): StoryModalBodyEnv {
  return {
    tabIds: ["general", "specs", "attachments", "threads"],
    tab: 0,
    shown: "general",
    specEditing: false,
    attachmentTask: false,
    paste: { busy: false, pending: [], saved: vi.fn(), summary: undefined } as unknown as StoryModalBodyEnv["paste"],
    savingNow: { current: false },
    setTabId: vi.fn(),
    setSubmitRequest: vi.fn(),
    setSaving: vi.fn(),
    onSubmit: vi.fn(),
    onConfirming: vi.fn(),
    ...overrides,
  };
}

describe("handleBodyKey", () => {
  it("goes to the next tab with shift+tab, and asks to delete with ctrl+d on the General tab", () => {
    const body = env();
    handleBodyKey(body, "", { ...noKey, tab: true, shift: true });
    expect(body.setTabId).toHaveBeenCalledWith("specs");
    handleBodyKey(body, "d", { ...noKey, ctrl: true });
    expect(body.onConfirming).toHaveBeenCalledWith("delete");
  });

  it("asks the Form to save with ctrl+s, but not while a spec is in the editor", () => {
    const body = env({ shown: "specs", tab: 1 });
    handleBodyKey(body, "s", { ...noKey, ctrl: true });
    expect(body.setSubmitRequest).toHaveBeenCalledOnce();
    const editing = env({ shown: "specs", tab: 1, specEditing: true });
    handleBodyKey(editing, "s", { ...noKey, ctrl: true });
    expect(editing.setSubmitRequest).not.toHaveBeenCalled();
  });
});

describe("submitStory", () => {
  it("saves the values with the pasted images, then clears the images", async () => {
    const body = env();
    await submitStory(body, { title: "Login" });
    expect(body.onSubmit).toHaveBeenCalledWith({ title: "Login" }, []);
    expect(body.paste.saved).toHaveBeenCalledOnce();
    expect(body.setSaving).toHaveBeenNthCalledWith(1, true);
    expect(body.setSaving).toHaveBeenLastCalledWith(false);
    expect(body.savingNow.current).toBe(false);
  });

  it("does not save while a paste or an earlier save runs", async () => {
    const pasting = env({ paste: { ...env().paste, busy: true } });
    await submitStory(pasting, { title: "Login" });
    const saving = env({ savingNow: { current: true } });
    await submitStory(saving, { title: "Login" });
    expect(pasting.onSubmit).not.toHaveBeenCalled();
    expect(saving.onSubmit).not.toHaveBeenCalled();
  });
});
