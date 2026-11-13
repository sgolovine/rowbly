import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";
import { updateProject } from "../../../../services/project/project.js";
import { createSpec, listSpecs } from "../../../../services/spec/spec.js";
import { createStory } from "../../../../services/story/story.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { createToastStore } from "../../../hooks/index.js";
import { clickRow, handleEditKey, removeStorySpec, type SpecsTabEnv } from "./specs-tab-actions.js";

const noKey = {} as Key;

describe("specs tab actions", () => {
  const project = useTestProject();

  function env(overrides: Partial<SpecsTabEnv> = {}): SpecsTabEnv {
    return {
      ctx: project.ctx,
      storyId: "ROW-01",
      toast: createToastStore(),
      drafts: {
        textOf: (spec) => spec.body,
        isUnsaved: () => false,
        edit: vi.fn(),
        flush: vi.fn(),
        forget: vi.fn(async () => {}),
      },
      current: undefined,
      cursor: 0,
      setMode: vi.fn(),
      setCursor: vi.fn(),
      setSelectSlug: vi.fn(),
      reload: vi.fn(),
      ...overrides,
    };
  }

  it("saves with ctrl+s and goes back to the list with tab in the editor", () => {
    const tab = env();
    handleEditKey(tab, "s", { ...noKey, ctrl: true });
    expect(tab.drafts.flush).toHaveBeenCalledOnce();
    handleEditKey(tab, "", { ...noKey, tab: true });
    expect(tab.setMode).toHaveBeenCalledWith({ kind: "list" });
  });

  it("edits the selected row on a click, and selects another row", () => {
    const tab = env({ cursor: 1 });
    clickRow(tab, 1);
    expect(tab.setMode).toHaveBeenLastCalledWith({ kind: "edit" });
    clickRow(tab, 0);
    expect(tab.setCursor).toHaveBeenCalledWith(0);
    expect(tab.setMode).toHaveBeenLastCalledWith({ kind: "list" });
  });

  it("deletes a spec of one Story, and removes a shared spec from the Story", async () => {
    await updateProject({ features: { specs: true } }, project.ctx);
    await createStory({ title: "Login" }, project.ctx);
    await createStory({ title: "Logout" }, project.ctx);
    const own = await createSpec({ title: "Own", stories: ["ROW-01"] }, project.ctx);
    const shared = await createSpec({ title: "Shared", stories: ["ROW-01", "ROW-02"] }, project.ctx);
    const tab = env();
    await removeStorySpec(tab, own);
    await removeStorySpec(tab, shared);
    expect(tab.drafts.forget).toHaveBeenCalledWith("own");
    expect(tab.toast.list().map((toast) => toast.message)).toEqual(["Deleted Own", "Removed Shared from ROW-01"]);
    expect((await listSpecs({}, project.ctx)).map((spec) => [spec.slug, spec.stories])).toEqual([
      ["shared", ["ROW-02"]],
    ]);
    expect(tab.reload).toHaveBeenCalledTimes(2);
  });

  it("shows a failed removal and goes back to the list", async () => {
    const tab = env();
    await removeStorySpec(tab, { slug: "gone", title: "Gone", stories: ["ROW-01"], body: "", path: "" });
    expect(tab.toast.list().map((toast) => toast.kind)).toEqual(["error"]);
    expect(tab.setMode).toHaveBeenCalledWith({ kind: "list" });
    expect(tab.reload).not.toHaveBeenCalled();
  });
});
