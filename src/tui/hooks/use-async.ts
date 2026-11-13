import {
  type DependencyList,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { writeRef } from "./refs.js";
import { type ToastStore, useToast } from "./toasts.js";

export interface AsyncState<T> {
  loading: boolean;
  error: unknown;
  data: T | undefined;
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

function settleData<T>(env: RunEnv<T>, data: T): void {
  if (!env.signal.aborted) {
    env.setState({ loading: false, error: undefined, data });
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

/** Starts a run in the background: the next run of the effect reads the flag. */
function refreshRun(background: RefObject<boolean>, setRun: Dispatch<SetStateAction<number>>): void {
  writeRef(background, true);
  setRun((n) => n + 1);
}

/**
 * Runs `fn` whenever `deps` change and tracks its loading, error and data states. A failure is also
 * shown as a toast, so a service error never crashes the app, even when `fn` throws before it returns
 * a promise. A run whose `deps` changed, or whose component unmounted, is ignored when it settles.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const toast = useToast();
  const [run, setRun] = useState(0);
  const background = useRef(false);
  const [state, setState] = useState<RunState<T>>({
    loading: true,
    error: undefined,
    data: undefined,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's `deps` decide when `fn` runs again.
  useEffect(() => {
    const live = new AbortController();
    const quiet = background.current;

    writeRef(background, false);
    startRun({ fn, toast, setState, signal: live.signal, quiet });

    return () => live.abort();
  }, [...deps, run]);

  const reload = useCallback(() => setRun((n) => n + 1), []);
  const refresh = useCallback(() => refreshRun(background, setRun), []);

  return { ...state, reload, refresh };
}
