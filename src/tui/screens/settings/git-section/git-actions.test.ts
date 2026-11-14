import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../../services/errors/errors.js";
import * as settings from "../../../../services/factory-settings/factory-settings.js";
import { createToastStore } from "../../../hooks/index.js";
import { type GitEnv, handleGitKey, saveAuthor, saveInterval, toggleSync } from "./git-actions.js";

vi.mock("../../../../services/factory-settings/factory-settings.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory-settings/factory-settings.js")>()),
  configureGit: vi.fn(async () => ({ version: 1, maxWorkers: 4 })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const noKey = {} as Key;

function env(data: settings.FactorySettings | null = { version: 1, maxWorkers: 4 }): GitEnv {
  return {
    ctx: {},
    toast: createToastStore(),
    settings: { data: data ?? undefined, reload: vi.fn(), refresh: vi.fn(), loading: false, error: undefined },
    setTask: vi.fn(),
    onChange: vi.fn(),
  } as unknown as GitEnv;
}

describe("gitActions", () => {
  it("opens a form with a, m and i, and ignores keys before the settings load", () => {
    const e = env();
    handleGitKey(e, "a", noKey);
    handleGitKey(e, "m", noKey);
    handleGitKey(e, "i", noKey);
    handleGitKey(e, "a", { ctrl: true } as Key);
    expect(vi.mocked(e.setTask).mock.calls).toEqual([["author"], ["message"], ["interval"]]);

    const empty = env(null);
    handleGitKey(empty, "a", noKey);
    handleGitKey(empty, "p", noKey);
    expect(empty.setTask).not.toHaveBeenCalled();
    expect(settings.configureGit).not.toHaveBeenCalled();
  });

  it("toggles push and pull from their current values", async () => {
    const e = env({ version: 1, maxWorkers: 4, git: { push: true } });
    handleGitKey(e, "p", noKey);
    toggleSync(e, "pull");
    expect(vi.mocked(settings.configureGit).mock.calls.map(([input]) => input)).toEqual([
      { gitPush: false },
      { gitPull: true },
    ]);
    await vi.waitFor(() => expect(e.onChange).toHaveBeenCalledTimes(2));
    expect(e.toast.list().map((t) => t.message)).toEqual(["Periodic push off", "Periodic pull on"]);
  });

  it("gives a validation error of the service the path of its field", async () => {
    vi.mocked(settings.configureGit).mockRejectedValueOnce(
      new ValidationError('Use "Name <email>" for the commit author'),
    );
    const author = await saveAuthor(env(), { author: "Bot" }).catch((error: unknown) => error);
    expect((author as ValidationError).details).toEqual({
      issues: [{ path: ["author"], message: 'Use "Name <email>" for the commit author' }],
    });

    vi.mocked(settings.configureGit).mockRejectedValueOnce(new ValidationError("Invalid factory settings"));
    const interval = await saveInterval(env(), { interval: 1 }).catch((error: unknown) => error);
    expect((interval as ValidationError).details).toEqual({
      issues: [{ path: ["interval"], message: "must be a whole number from 60 to 86400" }],
    });
  });

  it("shows a toast for a failed toggle", async () => {
    vi.mocked(settings.configureGit).mockRejectedValueOnce(new Error("disk full"));
    const e = env();
    toggleSync(e, "push");
    await vi.waitFor(() => expect(e.toast.list().some((t) => t.message.includes("disk full"))).toBe(true));
    expect(e.onChange).not.toHaveBeenCalled();
  });
});
