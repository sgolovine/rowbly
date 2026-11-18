import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameClock } from "./frame-clock.js";

describe("createFrameClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has no timer before the first subscribe and after the last unsubscribe", () => {
    const clock = createFrameClock({ frameCount: 3, intervalMs: 80 });

    expect(vi.getTimerCount()).toBe(0);

    const off = clock.subscribe(() => {});

    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses exactly one timer for two subscribers", () => {
    const clock = createFrameClock({ frameCount: 3, intervalMs: 80 });

    clock.subscribe(() => {});
    clock.subscribe(() => {});

    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps the timer while other subscribers stay, and starts a new timer after it stopped", () => {
    const clock = createFrameClock({ frameCount: 3, intervalMs: 80 });
    const offA = clock.subscribe(() => {});
    const offB = clock.subscribe(() => {});

    offA();
    expect(vi.getTimerCount()).toBe(1);

    offB();
    expect(vi.getTimerCount()).toBe(0);

    const listener = vi.fn();
    clock.subscribe(listener);

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(80);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("calls each subscriber and advances the frame by one for each interval, then wraps to 0", () => {
    const clock = createFrameClock({ frameCount: 3, intervalMs: 80 });
    const a = vi.fn();
    const b = vi.fn();

    clock.subscribe(a);
    clock.subscribe(b);

    expect(clock.frame()).toBe(0);

    vi.advanceTimersByTime(79);
    expect(a).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(clock.frame()).toBe(1);

    vi.advanceTimersByTime(80);
    expect(clock.frame()).toBe(2);

    vi.advanceTimersByTime(80);
    expect(clock.frame()).toBe(0);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(3);
  });

  it("does not call a subscriber after it unsubscribes", () => {
    const clock = createFrameClock({ frameCount: 3, intervalMs: 80 });
    const a = vi.fn();
    const offA = clock.subscribe(a);

    clock.subscribe(() => {});
    offA();
    vi.advanceTimersByTime(160);

    expect(a).not.toHaveBeenCalled();
  });

  it("keeps the subscriber count at zero when one unsubscribe runs two times", () => {
    const clock = createFrameClock({ frameCount: 3, intervalMs: 80 });
    const off = clock.subscribe(() => {});

    off();
    off();
    expect(vi.getTimerCount()).toBe(0);

    clock.subscribe(() => {});
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not stop the timer of other subscribers when an old unsubscribe runs again", () => {
    const clock = createFrameClock({ frameCount: 3, intervalMs: 80 });
    const listener = () => {};
    const off = clock.subscribe(listener);

    off();
    clock.subscribe(() => {});
    off();

    expect(vi.getTimerCount()).toBe(1);
  });
});
