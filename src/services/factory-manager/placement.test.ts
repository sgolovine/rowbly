import { describe, expect, it } from "vitest";
import type { HostSlots } from "./host-slots.js";
import { type PlacementInput, placeWorker } from "./placement.js";

function slot(id: string, max: number, used = 0, state: HostSlots["state"] = "connected"): HostSlots {
  return { id, state, max, used, free: Math.max(0, max - used) };
}

function input(change: Partial<PlacementInput> = {}): PlacementInput {
  return {
    policy: "prefer-local",
    hosts: [slot("local", 2), slot("a", 2), slot("b", 3)],
    providers: new Map([
      ["a", ["openai"]],
      ["b", ["openai"]],
    ]),
    provider: "openai",
    story: {},
    ...change,
  };
}

const pushedLocal = { host: "local", pushed: true, clean: true };

describe("placeWorker", () => {
  it("applies each policy to the eligible hosts", () => {
    expect(placeWorker(input({ policy: "prefer-local" }))).toEqual({ host: "local" });
    expect(placeWorker(input({ policy: "most-free" }))).toEqual({ host: "b" });
    expect(placeWorker(input({ policy: "prefer-remote" }))).toEqual({ host: "b" });
    const localFull = [slot("local", 2, 2), slot("a", 2), slot("b", 3)];
    expect(placeWorker(input({ policy: "prefer-local", hosts: localFull }))).toEqual({ host: "b" });
    const remoteFull = [slot("local", 2), slot("a", 2, 2), slot("b", 3, 3)];
    expect(placeWorker(input({ policy: "prefer-remote", hosts: remoteFull }))).toEqual({ host: "local" });
  });

  it("gives a tie in most-free to local, and a tie between worker hosts to the first host", () => {
    const tie = [slot("local", 3), slot("a", 3), slot("b", 3)];
    expect(placeWorker(input({ policy: "most-free", hosts: tie }))).toEqual({ host: "local" });
    expect(placeWorker(input({ policy: "prefer-remote", hosts: tie }))).toEqual({ host: "a" });
    const reversed = [slot("local", 1), slot("b", 3), slot("a", 3)];
    expect(placeWorker(input({ policy: "most-free", hosts: reversed }))).toEqual({ host: "b" });
  });

  it("skips a host with no free slot, a disconnected host and a host without the provider", () => {
    const hosts = [slot("local", 1, 1), slot("a", 4, 4), slot("b", 4, 0, "disconnected"), slot("c", 2)];
    const providers = new Map([
      ["a", ["openai"]],
      ["b", ["openai"]],
      ["c", ["anthropic"]],
    ]);
    const placement = placeWorker(input({ policy: "most-free", hosts, providers }));
    expect(placement.host).toBeUndefined();
    expect(placement.reason).toContain("worker capacity is full on host local");
    expect(placement.reason).toContain("host b is disconnected");
    expect(placement.reason).toContain("host c does not have the provider openai");
    const withC = new Map([...providers, ["c", ["anthropic", "openai"]]]);
    expect(placeWorker(input({ hosts, providers: withC }))).toEqual({ host: "c" });
  });

  it.each(["degraded", "disconnected", "version-mismatch", "auth-failed", "not-ready"] as const)(
    "gives no new worker to a %s host",
    (state) => {
      const hosts = [slot("local", 1, 1), slot("a", 4, 0, state)];
      const placement = placeWorker(input({ hosts }));
      expect(placement.host).toBeUndefined();
      expect(placement.reason).toContain(`host a is ${state}`);
      expect(placeWorker(input({ hosts, requested: "a" })).host).toBeUndefined();
    },
  );

  it("does not send a worker to a host without a known provider list or without a known model provider", () => {
    const hosts = [slot("local", 1, 1), slot("a", 2)];
    expect(placeWorker(input({ hosts, providers: new Map() })).reason).toContain("no host can take work");
    expect(placeWorker(input({ hosts, provider: undefined })).reason).toContain("provider of the worker model");
    expect(placeWorker(input({ hosts: [slot("local", 1)], provider: undefined }))).toEqual({ host: "local" });
  });

  it("keeps a Story on the host of its last worker when that host has a free slot", () => {
    expect(placeWorker(input({ story: { lastHost: "a" } }))).toEqual({ host: "a" });
    expect(placeWorker(input({ policy: "prefer-remote", story: { lastHost: "local" } }))).toEqual({
      host: "local",
    });
  });

  it("moves a Story from a full host only when its worktree there is pushed and clean", () => {
    const hosts = [slot("local", 2), slot("a", 2, 2), slot("b", 3)];
    const pushed = { lastHost: "a", worktree: { host: "a", pushed: true, clean: true } };
    expect(placeWorker(input({ hosts, story: pushed }))).toEqual({ host: "local" });
    const unknown = placeWorker(input({ hosts, story: { lastHost: "a" } }));
    expect(unknown.host).toBeUndefined();
    expect(unknown.reason).toContain("waits for host a");
    const dirty = { lastHost: "a", worktree: { host: "a", pushed: true, clean: false } };
    expect(placeWorker(input({ hosts, story: dirty })).reason).toContain("not known to be pushed and clean");
    const localFull = [slot("local", 1, 1), slot("a", 2)];
    const localPushed = { lastHost: "local", worktree: pushedLocal };
    expect(placeWorker(input({ hosts: localFull, story: localPushed }))).toEqual({ host: "a" });
  });

  it("keeps unpushed or uncommitted local work on local, also with prefer-remote", () => {
    const unpushed = { worktree: { host: "local", pushed: false, clean: true } };
    expect(placeWorker(input({ policy: "prefer-remote", story: unpushed }))).toEqual({ host: "local" });
    const dirty = { lastHost: "a", worktree: { host: "local", pushed: true, clean: false } };
    expect(placeWorker(input({ policy: "prefer-remote", story: dirty }))).toEqual({ host: "local" });
    const full = placeWorker(input({ hosts: [slot("local", 1, 1), slot("a", 2)], story: unpushed }));
    expect(full.reason).toContain("only local is permitted");
  });

  it("accepts a permitted requested host and refuses a host that the rules do not permit", () => {
    expect(placeWorker(input({ requested: "a" }))).toEqual({ host: "a" });
    expect(placeWorker(input({ requested: "local", policy: "prefer-remote" }))).toEqual({ host: "local" });
    expect(placeWorker(input({ requested: "missing" })).reason).toContain("unknown host missing");
    const full = [slot("local", 2), slot("a", 2, 2)];
    expect(placeWorker(input({ requested: "a", hosts: full })).reason).toContain("worker capacity is full");
    const unpushed = { worktree: { host: "local", pushed: false, clean: true } };
    expect(placeWorker(input({ requested: "a", story: unpushed })).reason).toContain("only local is permitted");
    expect(placeWorker(input({ requested: "b", story: { lastHost: "a" } })).reason).toContain(
      "the Story stays on host a",
    );
  });
});
