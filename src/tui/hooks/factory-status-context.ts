import { createContext, useContext } from "react";
import type { FactoryStatus } from "../../services/factory/factory.js";
import type { AsyncState } from "./use-async.js";

/**
 * The one factory status read of the shell. The views in the shell read the status from it, so that one
 * write of the status file causes one read. It is `undefined` outside of the shell.
 */
export const FactoryStatusContext = createContext<AsyncState<FactoryStatus | undefined> | undefined>(undefined);

/** The shared factory status of the shell, or `undefined` when no shell supplies it. */
export function useSharedFactoryStatus(): AsyncState<FactoryStatus | undefined> | undefined {
  return useContext(FactoryStatusContext);
}
