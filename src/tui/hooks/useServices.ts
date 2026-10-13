import { createContext, useContext } from 'react';
import { DataRootNotFoundError } from '../../core';
import type { RowblyContext, Services } from '../../services';

export interface ServicesValue {
  /** `null` when no Data Root exists yet (the setup screen is shown). */
  ctx: RowblyContext | null;
  services: Services | null;
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
