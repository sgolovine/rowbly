import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as factory from "../../../../services/factory/factory.js";
import { createToastStore } from "../../../hooks/index.js";
import { type FactoryKeyEnv, handleFactoryKey, runFactory } from "./factory-run.js";

vi.mock("../../../../services/factory/factory.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory/factory.js")>()),
  startFactory: vi.fn(async () => ({})),
  stopFactory: vi.fn(async () => {
    throw new Error("no daemon");
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const launch = { executable: "/usr/bin/node", execArgv: [], entry: "/opt/rowbly/cli.js" };

function env(overrides: Partial<FactoryKeyEnv> = {}): FactoryKeyEnv {
  return {
    ctx: {},
    launch,
    toast: createToastStore(),
    working: { current: false },
    checkProvider: vi.fn(async () => false),
    setBusy: vi.fn(),
    setProvider: vi.fn(),
    canStart: true,
    canStop: true,
    canInspect: true,
    canWarnings: false,
    openWarnings: vi.fn(),
    setConfirm: vi.fn(),
    setInspect: vi.fn(),
    setHistory: vi.fn(),
    onAiSettings: vi.fn(),
    ...overrides,
  };
}

const key = (overrides: Partial<Key> = {}) => ({ ...overrides }) as Key;

describe("factoryRun", () => {
  it("checks the providers, starts the factory and shows a toast", async () => {
    const e = env();

    await runFactory(e, "start");

    expect(e.setProvider).toHaveBeenCalledWith(false);
    expect(factory.startFactory).toHaveBeenCalledWith({ launch }, {});
    expect(e.toast.list().map((t) => t.message)).toEqual(["Started the factory"]);
    expect(e.setBusy).toHaveBeenLastCalledWith(null);
    expect(e.working.current).toBe(false);
  });

  it("shows the error of a stop and does nothing while a different run works", async () => {
    const e = env();

    await runFactory(e, "stop");

    expect(e.toast.list().map((t) => t.kind)).toEqual(["error"]);

    await runFactory(env({ working: { current: true } }), "start");

    expect(factory.startFactory).not.toHaveBeenCalled();
  });

  it("routes the keys of the controls", () => {
    const e = env();

    handleFactoryKey(e, "x", key());
    handleFactoryKey(e, "", key({ return: true }));
    handleFactoryKey(e, "h", key());
    handleFactoryKey(e, "a", key());
    handleFactoryKey(e, "h", key({ ctrl: true }));

    expect(e.setConfirm).toHaveBeenCalledWith(true);
    expect(e.setInspect).toHaveBeenCalledWith(true);
    expect(e.setHistory).toHaveBeenCalledOnce();
    expect(e.onAiSettings).toHaveBeenCalledOnce();
  });

  it("opens the warnings with w only when the factory has warnings", () => {
    const none = env();

    handleFactoryKey(none, "w", key());

    expect(none.openWarnings).not.toHaveBeenCalled();

    const some = env({ canWarnings: true });

    handleFactoryKey(some, "w", key());

    expect(some.openWarnings).toHaveBeenCalledOnce();
  });

  it("ignores the keys of actions that cannot run now", () => {
    const e = env({ canStop: false, canInspect: false, onAiSettings: undefined });

    handleFactoryKey(e, "x", key());
    handleFactoryKey(e, "", key({ return: true }));
    handleFactoryKey(e, "a", key());

    expect(e.setConfirm).not.toHaveBeenCalled();
    expect(e.setInspect).not.toHaveBeenCalled();
  });
});
