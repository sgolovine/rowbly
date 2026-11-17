import { describe, expect, it } from "vitest";
import type { ThreadRecord } from "../thread/thread-types.js";
import { connectionLostText, lostConnections, threadConnection } from "./connection-lost.js";

const NOW = Date.parse("2026-11-16T10:05:00.000Z");
const SEEN = "2026-11-16T10:03:20.000Z";

function thread(id: string, host: string, status: ThreadRecord["status"] = "running"): ThreadRecord {
  return { id, role: "worker", storyId: `ROW-${id}`, host, status } as ThreadRecord;
}

const hosts = [
  { id: "local", state: "connected" as const },
  { id: "off", state: "disconnected" as const, lastSeenAt: SEEN },
  { id: "auth", state: "auth-failed" as const },
  { id: "good", state: "connected" as const, lastSeenAt: SEEN },
  { id: "slow", state: "degraded" as const, lastSeenAt: SEEN },
];

describe("lostConnections", () => {
  it("gives the remote Threads whose host is lost or not in the list", () => {
    const threads = [
      thread("1", "off"),
      thread("2", "auth", "pending"),
      thread("3", "good"),
      thread("4", "slow"),
      thread("5", "gone"),
      thread("6", "local"),
      thread("7", "off", "completed"),
      thread("8", "off", "failed"),
    ];

    expect(lostConnections(threads, hosts, NOW)).toEqual([
      {
        threadId: "1",
        storyId: "ROW-1",
        host: "off",
        hostState: "disconnected",
        lastSeenAt: SEEN,
        lastContactMs: 100_000,
      },
      { threadId: "2", storyId: "ROW-2", host: "auth", hostState: "auth-failed" },
      { threadId: "5", storyId: "ROW-5", host: "gone", hostState: "unknown" },
    ]);
  });

  it("gives no lost connection without a hosts list", () => {
    expect(lostConnections([thread("1", "off"), thread("5", "gone")], undefined, NOW)).toEqual([]);
  });

  it("never gives a lost connection for a Thread without a host", () => {
    const old = { ...thread("1", "local"), host: undefined } as ThreadRecord;

    expect(threadConnection(old, [])).toBeUndefined();
  });
});

describe("connectionLostText", () => {
  it("gives the time since the last contact, or no contact", () => {
    expect(connectionLostText({ state: "lost", host: "off", hostState: "disconnected", lastSeenAt: SEEN }, NOW)).toBe(
      "connection lost (last contact 1m40s ago)",
    );
    expect(connectionLostText({ state: "lost", host: "auth", hostState: "auth-failed" }, NOW)).toBe(
      "connection lost (no contact)",
    );
  });
});
