import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import type { RefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui } from "../testing/index.js";
import { runExclusive, useLatest, writeRef } from "./refs.js";

afterEach(cleanup);

function LatestProbe({ value, refs }: { value: string; refs: RefObject<string>[] }) {
  const latest = useLatest(value);
  refs.push(latest);
  return <Text>{value}</Text>;
}

describe("writeRef", () => {
  it("gives the ref a new value", () => {
    const ref: RefObject<number> = { current: 1 };

    writeRef(ref, 2);

    expect(ref.current).toBe(2);
  });
});

describe("useLatest", () => {
  it("keeps one ref that holds the value of the last render", async () => {
    const refs: RefObject<string>[] = [];
    const tui = await renderTui(<LatestProbe value="first" refs={refs} />);

    await tui.rerender(<LatestProbe value="second" refs={refs} />);

    expect(new Set(refs).size).toBe(1);
    expect(refs[0]?.current).toBe("second");
  });
});

describe("runExclusive", () => {
  it("skips a task while an earlier task runs, then runs again after it ends", async () => {
    const busy: RefObject<boolean> = { current: false };
    const runs: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = runExclusive(busy, async () => {
      runs.push("first");
      await gate;
    });
    await runExclusive(busy, async () => {
      runs.push("skipped");
    });
    expect(busy.current).toBe(true);

    release();
    await first;
    await runExclusive(busy, async () => {
      runs.push("third");
    });

    expect(runs).toEqual(["first", "third"]);
    expect(busy.current).toBe(false);
  });

  it("clears the busy flag when the task fails", async () => {
    const busy: RefObject<boolean> = { current: false };

    await expect(
      runExclusive(busy, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(busy.current).toBe(false);
  });
});
