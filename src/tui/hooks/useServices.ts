import { createContext, useContext } from 'react';
import { DataRootNotFoundError } from '../../core';
import { createServices, type RowblyContext, type Services } from '../../services';

export interface ServicesValue {
  /** `null` when no Data Root exists yet (the setup screen is shown). */
  ctx: RowblyContext | null;
  services: Services | null;
  /**
   * Switches the app to another context, e.g. the Data Root the setup screen just created, and
   * resolves to its services once its Plugins are loaded.
   */
  activate?(ctx: RowblyContext): Promise<Services>;
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
 * Switches the whole app to `ctx` and fresh services over it, and resolves to those services.
 * Outside the App it only makes the services.
 */
export function useActivate(): (ctx: RowblyContext) => Promise<Services> {
  return useContext(ServicesContext).activate ?? (async (ctx) => createServices(ctx));
}
