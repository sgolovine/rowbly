import { useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { type FactorySettings, getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  type AsyncState,
  type Layout,
  useAsync,
  useIsActive,
  useKeyHints,
  useLayout,
  useToast,
} from "../../../hooks/index.js";
import { type AiProvider, type AiStatus, type AiTask, aiHints } from "../ai-view.js";
import { type AiEnv, handleAiKey, loadStatus } from "./ai-actions.js";

/** The inputs of the AI settings. */
interface AiSectionInput {
  readonly ctx: ServiceContext;
  readonly onChange: () => void;
  readonly loadRuntime: () => Promise<AuthRuntime>;
}

/** The state of the AI settings for one render. */
interface AiSectionModel {
  readonly env: AiEnv;
  readonly layout: Layout;
  readonly task: AiTask;
  /** True when no task on top has the keys. */
  readonly idle: boolean;
  /** True when Pi and the providers have loaded. */
  readonly ready: boolean;
  readonly loading: boolean;
  readonly provider: AiProvider | undefined;
  readonly canSignIn: boolean;
  readonly canSignOut: boolean;
  readonly runtime: AsyncState<AuthRuntime>;
  readonly status: AsyncState<AiStatus | undefined>;
  readonly settings: AsyncState<FactorySettings>;
  readonly setFiltering: Dispatch<SetStateAction<boolean>>;
}

/** The state, the keys and the handlers of the AI settings. Pi loads only when the section opens. */
export function useAiSection({ ctx, onChange, loadRuntime }: AiSectionInput): AiSectionModel {
  const active = useIsActive();
  const layout = useLayout();
  const toast = useToast();
  const [task, setTask] = useState<AiTask>(null);
  const [selected, setSelected] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const runtime = useAsync(loadRuntime, [loadRuntime]);
  const status = useAsync(() => loadStatus(runtime.data), [runtime.data]);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);

  const providers = status.data?.providers ?? [];
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const ready = runtime.data !== undefined && status.data !== undefined;
  const idle = active && task === null;
  const canSignIn = ready && provider !== undefined && provider.methods.length > 0;
  const canSignOut = ready && provider?.credentialType !== undefined;
  const env: AiEnv = {
    ctx,
    toast,
    runtime,
    status,
    settings,
    providers,
    ready,
    canSignOut,
    setTask,
    setSelected,
    onChange,
  };

  useKeyHints(aiHints({ idle, list: providers.length > 0, signIn: canSignIn, signOut: canSignOut, ready }));
  useInput((input, key) => handleAiKey(env, input, key), { isActive: idle && !filtering });

  return {
    env,
    layout,
    task,
    idle,
    ready,
    loading: runtime.loading || (runtime.data !== undefined && status.loading),
    provider,
    canSignIn,
    canSignOut,
    runtime,
    status,
    settings,
    setFiltering,
  };
}
