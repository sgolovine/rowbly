import { createContext, useContext } from 'react';
import { DataRootNotFoundError } from '../../core';
import type { RowblyContext, Services } from '../../services';

export interface ServicesValue {
  /** `null` when no Data Root exists yet (the setup screen is shown). */
  ctx: RowblyContext | null;
  services: Services | null;
  /**
   * Switches the app to another context, e.g. the Data Root the setup screen just created, once its
   * Plugins load. Resolves `false` when a later call replaced it before then.
   */
  activate?(ctx: RowblyContext): Promise<boolean>;
}

export const ServicesContext = createContext<ServicesValue>({ ctx: null, services: null });

/** The services for the current Data Root. Throws `DataRootNotFoundError` when there is none. */
export function useServices(): Services {
  const { services } = useContext(ServicesContext);
  if (!services) throw new DataRootNotFoundError();
  return services;
}

/** The resolved context (Data Root, Local State, Me), or `null` before setup. */
export function useRowblyContext(): RowblyContext | null {
  return useContext(ServicesContext).ctx;
}

/**
 * Switches the whole app to `ctx` and fresh services over it. Another Data Root opens on the home
 * screen with none of the previous one's screens; the same one keeps its screens. A no-op outside the App.
 */
export function useActivate(): (ctx: RowblyContext) => Promise<boolean> {
  return useContext(ServicesContext).activate ?? (async () => false);
}
