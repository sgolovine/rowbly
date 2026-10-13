import { type DependencyList, useCallback, useEffect, useState } from 'react';
import { useToast } from './toasts';

export interface AsyncState<T> {
  loading: boolean;
  error: unknown;
  data: T | undefined;
  /** Runs `fn` again. */
  reload(): void;
}

/**
 * Runs `fn` whenever `deps` change and tracks its loading, error and data states. A failure is also
 * shown as a toast, so a service error never crashes the app.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const toast = useToast();
  const [run, setRun] = useState(0);
  const [state, setState] = useState<{ loading: boolean; error: unknown; data: T | undefined }>({
    loading: true,
    error: undefined,
    data: undefined,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's `deps` decide when `fn` runs again.
  useEffect(() => {
    let current = true;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    fn().then(
      (data) => {
        if (current) setState({ loading: false, error: undefined, data });
      },
      (error: unknown) => {
        if (!current) return;
        setState({ loading: false, error, data: undefined });
        toast.error(error);
      },
    );
    return () => {
      current = false;
    };
  }, [...deps, run]);

  const reload = useCallback(() => setRun((n) => n + 1), []);
  return { ...state, reload };
}
