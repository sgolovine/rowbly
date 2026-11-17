import { Store, withMember, withoutMember } from "../store/store.js";

/** A clock that counts animation frames. One timer runs only while the clock has a subscriber. */
export interface FrameClock {
  /** Adds a listener for each frame, and gives the function that removes it. */
  subscribe(listener: () => void): () => void;
  /** The index of the current frame, from 0 to `frameCount - 1`. */
  frame(): number;
}

interface FrameClockOptions {
  readonly frameCount: number;
  readonly intervalMs: number;
}

interface FrameClockState {
  readonly listeners: ReadonlySet<() => void>;
  readonly frame: number;
  readonly timer: ReturnType<typeof setInterval> | undefined;
}

interface FrameClockEnv {
  readonly options: FrameClockOptions;
  readonly cell: Store<FrameClockState>;
}

function tick(env: FrameClockEnv): void {
  const { listeners } = env.cell.update((state) => ({ frame: (state.frame + 1) % env.options.frameCount }));

  for (const listener of listeners) {
    listener();
  }
}

function startTimer(env: FrameClockEnv): void {
  if (env.cell.current.timer !== undefined) {
    return;
  }

  env.cell.update(() => ({ timer: setInterval(() => tick(env), env.options.intervalMs) }));
}

function stopTimerWhenIdle(env: FrameClockEnv): void {
  const { listeners, timer } = env.cell.current;

  if (listeners.size > 0 || timer === undefined) {
    return;
  }

  clearInterval(timer);
  env.cell.update(() => ({ timer: undefined }));
}

function unsubscribe(env: FrameClockEnv, listener: () => void): void {
  env.cell.update((state) => ({ listeners: withoutMember(state.listeners, listener) }));
  stopTimerWhenIdle(env);
}

function subscribe(env: FrameClockEnv, listener: () => void): () => void {
  env.cell.update((state) => ({ listeners: withMember(state.listeners, listener) }));
  startTimer(env);

  return () => unsubscribe(env, listener);
}

/** Makes a frame clock. The timer starts at the first subscriber and stops when the last one leaves. */
export function createFrameClock(options: FrameClockOptions): FrameClock {
  const env: FrameClockEnv = {
    options,
    cell: new Store<FrameClockState>({ listeners: new Set(), frame: 0, timer: undefined }),
  };

  return {
    subscribe: (listener) => subscribe(env, listener),
    frame: () => env.cell.current.frame,
  };
}
