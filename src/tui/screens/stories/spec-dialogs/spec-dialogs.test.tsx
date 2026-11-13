import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Spec } from "../../../../services/spec/spec.js";
import { keys, renderTui } from "../../../testing/index.js";
import { removeMessage, SpecDialogs, type SpecDialogsProps } from "./spec-dialogs.js";

afterEach(cleanup);

const spec: Spec = { slug: "api", title: "API", stories: ["ROW-01"], body: "", path: "/p/.rowbly/specs/api.md" };

function props(overrides: Partial<SpecDialogsProps>): SpecDialogsProps {
  return {
    mode: { kind: "list" },
    storyId: "ROW-01",
    onCreate: vi.fn(async () => {}),
    onRename: vi.fn(async () => {}),
    onRemove: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("removeMessage", () => {
  it("removes a shared spec from the Story, and deletes a spec of one Story", () => {
    expect(removeMessage({ ...spec, stories: ["ROW-01", "ROW-02"] }, "ROW-01")).toBe(
      "Remove API from ROW-01? It stays linked to ROW-02.",
    );
    expect(removeMessage(spec, "ROW-01")).toBe("Delete API? You cannot undo this.");
  });
});

describe("SpecDialogs", () => {
  it("shows nothing in the list mode", async () => {
    const tui = await renderTui(<SpecDialogs {...props({})} />);
    expect(tui.frame().trim()).toBe("");
  });

  it("gives the title of a new spec", async () => {
    const onCreate = vi.fn(async () => {});
    const tui = await renderTui(<SpecDialogs {...props({ mode: { kind: "new" }, onCreate })} />);
    expect(tui.frame()).toContain("New Spec");
    await tui.type("Login");
    await tui.press(keys.enter);
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith({ title: "Login" }));
  });

  it("asks before it removes a spec", async () => {
    const onRemove = vi.fn();
    const tui = await renderTui(<SpecDialogs {...props({ mode: { kind: "remove", spec }, onRemove })} />);
    expect(tui.frame()).toContain("Delete API? You cannot undo this.");
    await tui.press("y");
    expect(onRemove).toHaveBeenCalledWith(spec);
  });

  it("shows the old title in the rename form", async () => {
    const tui = await renderTui(<SpecDialogs {...props({ mode: { kind: "rename", spec } })} />);
    expect(tui.frame()).toContain("Rename Spec › API");
  });
});
