import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";
import { createToastStore } from "../../../hooks/index.js";
import type { AiEnv } from "./ai-actions.js";
import { handleSectionKey, openCheck } from "./check-actions.js";

const state = () => ({ reload: vi.fn(), refresh: vi.fn(), loading: false });
const key = (overrides: Partial<Key> = {}) => ({ ...overrides }) as Key;
const settings = { version: 1, maxWorkers: 2, checks: { items: [{ key: "test", command: "pnpm test" }] } };

function env(overrides: Partial<AiEnv> = {}): AiEnv {
  return {
    ctx: {},
    toast: createToastStore(),
    runtime: state(),
    status: state(),
    settings: { ...state(), data: settings },
    stages: state(),
    stageCursor: 0,
    setStageCursor: vi.fn(),
    checkCursor: 0,
    setCheckCursor: vi.fn(),
    providers: [],
    page: "checks",
    ready: true,
    canSignOut: false,
    setPage: vi.fn(),
    setTask: vi.fn(),
    setSelected: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  } as AiEnv;
}

describe("check actions", () => {
  it("opens the check limits, a new check, the edit of the selected check and its removal", () => {
    const e = env();

    handleSectionKey(e, "c", key());
    handleSectionKey(e, "n", key());
    handleSectionKey(e, "", key({ return: true }));
    handleSectionKey(e, "d", key());

    expect(e.setTask).toHaveBeenNthCalledWith(1, { kind: "checkLimits" });
    expect(e.setTask).toHaveBeenNthCalledWith(2, { kind: "check" });
    expect(e.setTask).toHaveBeenNthCalledWith(3, { kind: "check", check: expect.objectContaining({ key: "test" }) });
    expect(e.setTask).toHaveBeenNthCalledWith(4, {
      kind: "removeCheck",
      check: expect.objectContaining({ key: "test" }),
    });
  });

  it("uses the check keys only on the Checks tab, and keeps the tab keys", () => {
    const e = env({ page: "limits" });

    handleSectionKey(e, "c", key());
    handleSectionKey(e, "", key({ rightArrow: true }));

    expect(e.setTask).not.toHaveBeenCalled();
    expect(e.setPage).toHaveBeenCalledWith("checks");
  });

  it("moves the cursor and opens a check by its index", () => {
    const e = env();

    handleSectionKey(e, "", key({ downArrow: true }));
    openCheck(e, 0);
    openCheck(e, 5);

    expect(e.setCheckCursor).toHaveBeenCalledTimes(3);
    expect(e.setTask).toHaveBeenCalledOnce();
  });
});
