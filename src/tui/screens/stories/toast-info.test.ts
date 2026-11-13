import { describe, expect, it } from "vitest";
import { createToastStore } from "../../hooks/index.js";
import { toastInfo } from "./toast-info.js";

describe("toastInfo", () => {
  it("shows an info toast with the message", () => {
    const toast = createToastStore();

    toastInfo(toast, "Saved ROW-01");

    expect(toast.list()).toMatchObject([{ kind: "info", message: "Saved ROW-01" }]);
  });
});
