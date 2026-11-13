import { describe, expect, it, vi } from "vitest";
import { stopOnAbort } from "./stop-on-abort.js";

describe("stopOnAbort", () => {
  it("calls the unsubscribe one time when the signal aborts", () => {
    const live = new AbortController();
    const unsubscribe = vi.fn();

    stopOnAbort(live.signal, unsubscribe);
    expect(unsubscribe).not.toHaveBeenCalled();

    live.abort();
    live.abort();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("calls the unsubscribe at once when the signal has aborted already", () => {
    const live = new AbortController();
    const unsubscribe = vi.fn();

    live.abort();
    stopOnAbort(live.signal, unsubscribe);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
