import { useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { type FactorySettings, getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { listStages, type Stage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  type AsyncState,
  type Layout,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useLayout,
  useToast,
} from "../../../hooks/index.js";
import {
  type AiAbilities,
  type AiPage,
  type AiProvider,
  type AiStatus,
  type AiTask,
  aiHints,
  pageProviders,
} from "../ai-view.js";
import { type AiEnv, handleAiKey, loadStatus, openPage } from "./ai-actions.js";

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
  readonly page: AiPage;
  readonly task: AiTask;
  /** True when no task on top has the keys. */
  readonly idle: boolean;
  /** True when Pi and the providers have loaded. */
  readonly ready: boolean;
  readonly loading: boolean;
  /** The highlighted provider of the page. */
  readonly provider: AiProvider | undefined;
  readonly canSignIn: boolean;
  readonly canSignOut: boolean;
  readonly runtime: AsyncState<AuthRuntime>;
  readonly status: AsyncState<AiStatus | undefined>;
  readonly settings: AsyncState<FactorySettings>;
  readonly stages: AsyncState<readonly Stage[]>;
  readonly setFiltering: Dispatch<SetStateAction<boolean>>;
}

/** The inputs of `pageAbilities`. */
interface PageInput {
  readonly page: AiPage;
  readonly idle: boolean;
  readonly ready: boolean;
  readonly providers: readonly AiProvider[];
  readonly provider: AiProvider | undefined;
  readonly stages: readonly Stage[] | undefined;
}

/** What works now on the page: the sign-in and the sign-out need the highlighted provider. */
function pageAbilities({ page, idle, ready, providers, provider, stages }: PageInput): AiAbilities {
  return {
    idle,
    list: providers.length > 0,
    signIn: ready && page === "addProvider" && provider !== undefined && provider.methods.length > 0,
    signOut: ready && page === "providers" && provider?.credentialType !== undefined,
    ready,
    stages: (stages?.length ?? 0) > 0,
  };
}

/**
 * The state, the keys and the handlers of the AI settings. Pi loads only when the section opens. The sign-in
 * page takes `esc`, so that `esc` goes back to the signed-in providers and not to the section list.
 */
export function useAiSection({ ctx, onChange, loadRuntime }: AiSectionInput): AiSectionModel {
  const active = useIsActive();
  const layout = useLayout();
  const toast = useToast();
  const [page, setPage] = useState<AiPage>("providers");
  const [task, setTask] = useState<AiTask>(null);
  const [selected, setSelected] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const runtime = useAsync(loadRuntime, [loadRuntime]);
  const status = useAsync(() => loadStatus(runtime.data), [runtime.data]);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);
  const stages = useAsync<readonly Stage[]>(() => listStages(ctx), [ctx]);
  const [stageCursor, setStageCursor] = useState(0);

  const providers = pageProviders(page, status.data?.providers ?? []);
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const ready = runtime.data !== undefined && status.data !== undefined;
  const idle = active && task === null;
  const keysOwn = idle && !filtering;
  const can = pageAbilities({ page, idle, ready, providers, provider, stages: stages.data });
  const env: AiEnv = {
    ctx,
    toast,
    runtime,
    status,
    settings,
    stages,
    stageCursor,
    setStageCursor,
    providers,
    page,
    ready,
    canSignOut: can.signOut,
    setPage,
    setTask,
    setSelected,
    onChange,
  };

  useKeyHints(aiHints(page, can));
  useKeyCapture(idle && page === "addProvider", { text: false, escape: true });
  useEscape(keysOwn && page === "addProvider", () => openPage(env, "providers"));
  useInput((input, key) => handleAiKey(env, input, key), { isActive: keysOwn });

  return {
    env,
    layout,
    page,
    task,
    idle,
    ready,
    loading: runtime.loading || (runtime.data !== undefined && status.loading),
    provider,
    canSignIn: can.signIn,
    canSignOut: can.signOut,
    runtime,
    status,
    settings,
    stages,
    setFiltering,
  };
}
