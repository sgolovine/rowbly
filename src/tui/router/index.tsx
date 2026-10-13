import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

export type RouteParams = Record<string, unknown>;

/** One entry on the router stack: a screen name from `screens/index.ts` and its params. */
export interface Route {
  screen: string;
  params: RouteParams;
}

export interface Router {
  stack: readonly Route[];
  current: Route;
  /** Opens `screen` on top of the current one. */
  push(screen: string, params?: RouteParams): void;
  /** Goes back one screen. Returns false (and does nothing) at the root. */
  pop(): boolean;
  /** Swaps the current screen for `screen`. */
  replace(screen: string, params?: RouteParams): void;
  /** Closes every screen and opens `screen` as the root. */
  reset(screen: string, params?: RouteParams): void;
}

const RouterContext = createContext<Router | null>(null);

export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<readonly Route[]>([initial]);
  const router = useMemo<Router>(
    () => ({
      stack,
      current: stack[stack.length - 1] ?? initial,
      push: (screen, params = {}) => setStack((prev) => [...prev, { screen, params }]),
      pop: () => {
        if (stack.length <= 1) return false;
        setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
        return true;
      },
      replace: (screen, params = {}) => setStack((prev) => [...prev.slice(0, -1), { screen, params }]),
      reset: (screen, params = {}) => setStack([{ screen, params }]),
    }),
    [stack, initial],
  );
  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (!router) throw new Error('useRouter must be used inside <RouterProvider>');
  return router;
}

/** A route's breadcrumb label: `params.title` when given, else the capitalised screen name. */
export function routeTitle(route: Route): string {
  if (typeof route.params.title === 'string') return route.params.title;
  return route.screen.charAt(0).toUpperCase() + route.screen.slice(1);
}
