import { useInput } from "ink";
import { useState } from "react";
import type { PiCatalog } from "../../../../services/pi-catalog-cache/pi-catalog-cache.js";
import { loadPiCatalog, type PiCatalogSource } from "../../../../services/pi-catalog-cache/pi-catalog-refresh.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type AsyncState, useAsync, useEscape, useIsActive, useKeyCapture, useToast } from "../../../hooks/index.js";
import { handleSetupKey, type SetupEnv, skipSetup } from "./setup-actions.js";

/** The inputs of the worker model setup. */
export interface SetupInput {
  readonly ctx: ServiceContext;
  readonly source: PiCatalogSource;
  readonly onClose: () => void;
  readonly onAiSettings: () => void;
}

/** The state of the worker model setup for one render. */
export interface SetupModel {
  readonly env: SetupEnv;
  readonly catalog: AsyncState<PiCatalog>;
  /** True when a provider is signed in. Undefined while the models load. */
  readonly signedIn: boolean | undefined;
  readonly picking: boolean;
  readonly active: boolean;
}

/** True when a provider of the catalog is signed in. Undefined while the catalog loads or after a failure. */
function signedInOf(catalog: PiCatalog | undefined): boolean | undefined {
  return catalog?.providers.some((provider) => provider.configured);
}

/** The state, the keys and the handlers of the worker model setup. `esc` closes the picker first, then the setup. */
export function useSetup(input: SetupInput): SetupModel {
  const active = useIsActive();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const catalog = useAsync(() => loadPiCatalog(input.source, input.ctx), [input.ctx, input.source]);

  const signedIn = signedInOf(catalog.data);
  const ready = signedIn === true && (catalog.data?.models.length ?? 0) > 0;
  const env: SetupEnv = { ...input, toast, ready, setPicking };

  useKeyCapture(active, { text: false, escape: true });
  useEscape(active && !picking, () => skipSetup(env));
  useInput((text) => handleSetupKey(env, text), { isActive: active && !picking });

  return { env, catalog, signedIn, picking, active };
}
