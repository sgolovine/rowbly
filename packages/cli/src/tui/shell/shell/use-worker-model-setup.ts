import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { getFactorySettings, hasWorkerModel } from "../../../services/factory-settings/factory-settings.js";
import { withMember } from "../../../services/store/store.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { useAsync } from "../../hooks/index.js";
import type { Overlay } from "../overlay.js";

/** The inputs of the worker model setup of the shell. */
interface SetupInput {
  readonly ctx: ServiceContext;
  /** The root of the open Project, or `undefined` while no Project shows. */
  readonly root: string | undefined;
  readonly overlay: Overlay | null;
  readonly setOverlay: Dispatch<SetStateAction<Overlay | null>>;
}

/** The result of a check of one Project root. */
interface MissingModel {
  readonly root: string;
  readonly missing: boolean;
}

interface AskEnv extends SetupInput {
  readonly asked: ReadonlySet<string>;
  readonly setAsked: Dispatch<SetStateAction<ReadonlySet<string>>>;
}

/** Tells if the Project at the root has no worker model. A failed read does not ask. */
async function missingModel(ctx: ServiceContext, root: string | undefined): Promise<MissingModel | undefined> {
  if (root === undefined) {
    return undefined;
  }

  const missing = await getFactorySettings({ ...ctx, cwd: root }).then(
    (settings) => !hasWorkerModel(settings),
    () => false,
  );

  return { root, missing };
}

/** Opens the setup one time for each Project root, when the check of the current root found no model. */
function askOnce(env: AskEnv, result: MissingModel | undefined): void {
  if (!result || result.root !== env.root || !result.missing || env.asked.has(result.root)) {
    return;
  }

  env.setAsked((asked) => withMember(asked, result.root));

  // Another overlay that is open has priority. The setup does not ask again for this root in this process.
  if (env.overlay === null) {
    env.setOverlay({ kind: "workerModelSetup" });
  }
}

/**
 * Asks for the worker model when a Project without one opens: one time for each Project root while the TUI runs.
 * A skip is only in this state, so that the setup asks again at the next start. It never writes a file.
 */
export function useWorkerModelSetup(input: SetupInput): void {
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const missing = useAsync(() => missingModel(input.ctx, input.root), [input.root]);

  const env: AskEnv = { ...input, asked, setAsked };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new root or a new check result starts the effect.
  useEffect(() => askOnce(env, missing.data), [input.root, missing.data]);
}
