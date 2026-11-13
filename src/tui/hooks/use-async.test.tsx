import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui, settle } from "../testing/index.js";
import { type AsyncState, useAsync } from "./use-async.js";

afterEach(cleanup);

function Probe({ fn, states }: { fn: () => Promise<string>; states: AsyncState<string>[] }) {
  const state = useAsync(fn, []);
  states.push(state);
  return <Text>{state.data ?? "none"}</Text>;
}

/** Renders `useAsync(fn)` and keeps each state that the component renders. */
async function probe(fn: () => Promise<string>) {
  const states: AsyncState<string>[] = [];
  const tui = await renderTui(<Probe fn={fn} states={states} />);
  // The first load must end before a test starts a reload or a refresh.
  await vi.waitFor(() => expect(states.at(-1)?.loading).toBe(false));
  const { reload, refresh } = states.at(-1) as AsyncState<string>;
  return { tui, states, reload, refresh, latest: () => states.at(-1) as AsyncState<string> };
}

describe("useAsync", () => {
  it("shows loading during a reload", async () => {
    const { states, reload, latest } = await probe(() => settle(5).then(() => "data"));
    states.length = 0;
    reload();
    await settle(40);
    expect(states.some((state) => state.loading)).toBe(true);
    expect(latest().loading).toBe(false);
  });

  it("gets new data from a refresh without loading", async () => {
    let runs = 0;
    const { tui, states, refresh } = await probe(() => settle(5).then(() => (runs++ === 0 ? "old" : "new")));
    expect(tui.frame()).toContain("old");
    states.length = 0;
    refresh();
    await settle(40);
    expect(tui.frame()).toContain("new");
    expect(states.some((state) => state.loading)).toBe(false);
  });

  it("keeps the data and shows no toast when a refresh fails", async () => {
    const fn = vi.fn<() => Promise<string>>().mockResolvedValueOnce("old").mockRejectedValue(new Error("half written"));
    const { tui, refresh, latest } = await probe(fn);
    refresh();
    await settle(20);
    expect(tui.frame()).toContain("old");
    expect(tui.frame()).not.toContain("half written");
    expect(latest()).toMatchObject({ loading: false, error: undefined, data: "old" });
  });

  it("can use a refresh to recover after a failed load", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("broken")).mockResolvedValue("fixed");
    const { tui, refresh, latest } = await probe(fn);
    expect(latest().data).toBeUndefined();
    refresh();
    await vi.waitFor(() => expect(tui.frame()).toContain("fixed"));
  });
});
