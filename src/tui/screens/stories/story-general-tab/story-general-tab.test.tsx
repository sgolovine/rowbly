import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { StoryGeneralTab } from "./story-general-tab.js";

afterEach(cleanup);

describe("StoryGeneralTab", () => {
  it("shows the Form, saves on a submit request, and asks to delete on a click", async () => {
    const onSubmit = vi.fn(async () => {});
    const onDelete = vi.fn();
    const props = {
      fields: [{ name: "title", label: "Title", kind: "text" as const, required: true }],
      initialValues: { title: "Login" },
      height: undefined,
      active: true,
      formActive: true,
      onSubmit,
      onDelete,
    };
    const tui = await renderTui(<StoryGeneralTab {...props} submitRequest={0} />);
    expect(tui.frame()).toContain("Title");
    expect(tui.frame()).toContain("Login");
    await tui.rerender(<StoryGeneralTab {...props} submitRequest={1} />);
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ title: "Login" }));
    await tui.click("Delete");
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
