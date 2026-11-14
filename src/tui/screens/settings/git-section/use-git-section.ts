import { useInput } from "ink";
import { useState } from "react";
import { getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useAsync, useIsActive, useKeyHints, useToast } from "../../../hooks/index.js";
import { type GitEnv, handleGitKey } from "./git-actions.js";
import { type GitTask, gitHints } from "./git-view.js";

/** The inputs of the Git settings. */
interface GitSectionInput {
  readonly ctx: ServiceContext;
  readonly onChange: () => void;
}

/** The state of the Git settings for one render. */
interface GitSectionModel {
  readonly env: GitEnv;
  readonly task: GitTask;
  /** True when the settings have loaded and no form on top has the keys. */
  readonly idle: boolean;
}

/** The state, the keys and the handlers of the Git settings. It reads the factory settings and does not load Pi. */
export function useGitSection({ ctx, onChange }: GitSectionInput): GitSectionModel {
  const active = useIsActive();
  const toast = useToast();
  const [task, setTask] = useState<GitTask>(null);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);

  const idle = active && task === null && settings.data !== undefined;
  const env: GitEnv = { ctx, toast, settings, setTask, onChange };

  useKeyHints(gitHints(idle));
  useInput((input, key) => handleGitKey(env, input, key), { isActive: idle });

  return { env, task, idle };
}
