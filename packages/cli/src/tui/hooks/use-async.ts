import {
  type DependencyList,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLatest, writeRef } from "./refs.js";
import { type ToastStore, useToast } from "./toasts.js";

export interface AsyncState<T> {
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: T | undefined;
  /** Runs `fn` again. */
  reload(): void;
  /** Runs `fn` again in the background: `loading` stays false, and a failure keeps the data and shows no toast. */
  refresh(): void;
}

interface RunState<T> {
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: T | undefined;
}

/** What one run of `fn` reads and changes. */
interface RunEnv<T> {
  readonly fn: () => Promise<T>;
  readonly toast: ToastStore;
  readonly setState: Dispatch<SetStateAction<RunState<T>>>;
  /** Aborts when the `deps` change or the component unmounts, so the result of the run is ignored. */
  readonly signal: AbortSignal;
  /** A background run from `refresh`. */
  readonly quiet: boolean;
  /** The equality check of the caller, read when the run settles. */
  readonly isEqual: RefObject<((a: T, b: T) => boolean) | undefined>;
}

/** The options of `useAsync`. */
export interface AsyncOptions<T> {
  /** When a run gives data equal to the current data, the state object stays the same, so nothing renders again. */
  readonly isEqual?: (a: T, b: T) => boolean;
}

function startRun<T>(env: RunEnv<T>): void {
  if (!env.quiet) {
    env.setState((prev) => ({ ...prev, loading: true, error: undefined }));
  }

  // Called through `then`, so a synchronous throw from `fn` is a rejection like any other (RES-18C).
  Promise.resolve()
    .then(env.fn)
    .then(
      (data) => settleData(env, data),
      (error: unknown) => settleError(env, error),
    );
}

/** Keeps the state object when it already shows data equal to `data`, so that React skips the render. */
function nextData<T>(prev: RunState<T>, data: T, isEqual: ((a: T, b: T) => boolean) | undefined): RunState<T> {
  const settled = prev.data !== undefined && !prev.loading && prev.error === undefined;

  return settled && isEqual?.(prev.data as T, data) ? prev : { loading: false, error: undefined, data };
}

function settleData<T>(env: RunEnv<T>, data: T): void {
  if (!env.signal.aborted) {
    env.setState((prev) => nextData(prev, data, env.isEqual.current));
  }
}

function settleError<T>(env: RunEnv<T>, error: unknown): void {
  if (env.signal.aborted) {
    return;
  }

  if (env.quiet) {
    // A refresh can replace a load in progress, so it also ends `loading`.
    env.setState((prev) =>
      prev.data === undefined ? { loading: false, error, data: undefined } : { ...prev, loading: false },
    );

    return;
  }

  env.setState({ loading: false, error, data: undefined });
  env.toast.error(error);
}

/** What a background run reads: the newest `fn` and toast, and the controller of the run in progress. */
interface RefreshEnv<T> {
  readonly latest: RefObject<{ readonly fn: () => Promise<T>; readonly toast: ToastStore }>;
  readonly setState: Dispatch<SetStateAction<RunState<T>>>;
  /** The controller of the newest run, or `null` while no effect is mounted. */
  readonly current: RefObject<AbortController | null>;
  readonly isEqual: RefObject<((a: T, b: T) => boolean) | undefined>;
}

/**
 * Starts a run in the background, without a render. It replaces the run in progress, so that an older result does
 * not replace a newer one. A refresh after the unmount does nothing.
 */
function refreshRun<T>(env: RefreshEnv<T>): void {
  if (env.current.current === null) {
    return;
  }

  const live = new AbortController();
  const { fn, toast } = env.latest.current;

  env.current.current.abort();
  writeRef(env.current, live);
  startRun({ fn, toast, setState: env.setState, signal: live.signal, quiet: true, isEqual: env.isEqual });
}

/** Stops the run in progress when the `deps` change or the component unmounts. */
function abortCurrent(current: RefObject<AbortController | null>): void {
  current.current?.abort();
  writeRef(current, null);
}

/**
 * Runs `fn` whenever `deps` change and tracks its loading, error and data states. A failure is also
 * shown as a toast, so a service error never crashes the app, even when `fn` throws before it returns
 * a promise. A run whose `deps` changed, or whose component unmounted, is ignored when it settles.
 * With `options.isEqual`, a run that gives data equal to the current data does not change the state.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, options: AsyncOptions<T> = {}): AsyncState<T> {
  const toast = useToast();
  // Refs, so that a new function on each render does not run the effect again.
  const isEqual = useLatest(options.isEqual);
  const latest = useLatest({ fn, toast });
  const current = useRef<AbortController | null>(null);
  const [run, setRun] = useState(0);
  const [state, setState] = useState<RunState<T>>({
    loading: true,
    error: undefined,
    data: undefined,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's `deps` decide when `fn` runs again.
  useEffect(() => {
    const live = new AbortController();

    writeRef(current, live);
    startRun({ fn, toast, setState, signal: live.signal, quiet: false, isEqual });

    return () => abortCurrent(current);
  }, [...deps, run]);

  const reload = useCallback(() => setRun((n) => n + 1), []);
  // A refresh changes no state when it starts, so a poll that reads the same data renders nothing.
  const refresh = useCallback(() => refreshRun({ latest, setState, current, isEqual }), [latest, isEqual]);

  // The same object while nothing changes, so a context or a memo child that gets it does not render again.
  return useMemo(() => ({ ...state, reload, refresh }), [state, reload, refresh]);
}
