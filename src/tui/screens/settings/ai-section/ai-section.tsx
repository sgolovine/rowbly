import { Box } from "ink";
import { type AuthRuntime, authRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { Tabs } from "../../../components/index.js";
import { AiAddProviderPage } from "../ai-add-provider-page/index.js";
import { AiLimitsPage } from "../ai-limits-page/index.js";
import { AiModelsPage } from "../ai-models-page/index.js";
import { AiProvidersPage } from "../ai-providers-page/index.js";
import { AiTaskView } from "../ai-task/index.js";
import { AI_TABS, tabIndex } from "../ai-view.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { finishSignIn, openPage, pickProvider, reloadAll, saveLimit, saveModel, signOut } from "./ai-actions.js";
import { useAiSection } from "./use-ai-section.js";

/**
 * The AI settings of the factory, in three tabs. `←/→` or a click changes the tab.
 * - Providers: the signed-in providers of Pi. `d` asks before it signs out, and `n` opens the page that signs in
 *   to another provider. On that page, `enter` signs in and `esc` goes back.
 * - Models: the models of the supervisor and of the workers. `s` and `w` change them.
 * - Limits: the worker limit. `l` changes it.
 *
 * The sign-in is for this computer: Pi keeps the credentials, and the Project keeps no secret. The section
 * loads Pi only when it opens. The board does not need it.
 */
export function AiSection({
  ctx,
  onChange,
  loadRuntime = authRuntime,
}: SettingsSectionProps & {
  /** Loads the Pi model runtime; tests replace it. */
  loadRuntime?: () => Promise<AuthRuntime>;
}) {
  const model = useAiSection({ ctx, onChange, loadRuntime });

  const { env, idle, ready, page, settings } = model;

  return (
    <Box flexDirection="column" gap={1}>
      <Tabs
        tabs={AI_TABS.map((tab) => tab.label)}
        selected={tabIndex(page)}
        onSelect={(index) => openPage(env, AI_TABS[index]?.page ?? "providers")}
        active={idle}
      />
      {page === "providers" && (
        <AiProvidersPage
          loading={model.loading}
          ready={ready}
          providers={env.providers}
          idle={idle}
          canSignOut={model.canSignOut}
          height={model.layout.height}
          onHighlight={env.setSelected}
          onFilteringChange={model.setFiltering}
          onAddProvider={() => openPage(env, "addProvider")}
          onSignOut={() => env.setTask({ kind: "signOut" })}
          onReload={() => reloadAll(env)}
        />
      )}
      {page === "addProvider" && (
        <AiAddProviderPage
          ready={ready}
          providers={env.providers}
          idle={idle}
          canSignIn={model.canSignIn}
          height={model.layout.height}
          onHighlight={env.setSelected}
          onFilteringChange={model.setFiltering}
          onPick={(id) => pickProvider(env, id)}
          onSignIn={() => env.setTask({ kind: "signIn" })}
          onBack={() => openPage(env, "providers")}
        />
      )}
      {page === "models" && (
        <AiModelsPage
          settings={settings.data}
          ready={ready}
          idle={idle}
          onModel={(role) => env.setTask({ kind: "model", role })}
        />
      )}
      {page === "limits" && (
        <AiLimitsPage settings={settings.data} idle={idle} onLimit={() => env.setTask({ kind: "limit" })} />
      )}
      <AiTaskView
        task={model.task}
        ctx={ctx}
        runtime={model.runtime.data}
        provider={model.provider}
        status={model.status.data}
        settings={settings.data}
        onSignInDone={(signedIn) => finishSignIn(env, signedIn)}
        onSignOut={(id) => signOut(env, id)}
        onSaveModel={(role, choice) => saveModel(env, role, choice)}
        onSaveLimit={(values) => saveLimit(env, values)}
        onCancel={() => env.setTask(null)}
      />
    </Box>
  );
}
