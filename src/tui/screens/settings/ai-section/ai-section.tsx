import { Box } from "ink";
import { type AuthRuntime, authRuntime } from "../../../../services/agent-auth/agent-auth.js";
import type { CheckSpec, ModelChoice } from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { type FormValues, Tabs } from "../../../components/index.js";
import { AiAddProviderPage } from "../ai-add-provider-page/index.js";
import { AiChecksPage, type AiChecksPageProps } from "../ai-checks-page/index.js";
import { AiLimitsPage } from "../ai-limits-page/index.js";
import { AiModelsPage } from "../ai-models-page/index.js";
import { AiProvidersPage } from "../ai-providers-page/index.js";
import { AiTaskView } from "../ai-task/index.js";
import { AI_TABS, type Role, tabIndex } from "../ai-view.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import {
  type AiEnv,
  finishSignIn,
  openPage,
  openStageModel,
  pickProvider,
  reloadAll,
  saveLimit,
  saveModel,
  saveStageModel,
  signOut,
} from "./ai-actions.js";
import { openCheck, removeCheckItem, saveCheck, saveCheckLimits } from "./check-actions.js";
import { useAiSection } from "./use-ai-section.js";

/** The handlers of the task on top of the AI settings. */
function taskHandlers(env: AiEnv) {
  return {
    onSignInDone: (signedIn: boolean) => finishSignIn(env, signedIn),
    onSignOut: (id: string) => signOut(env, id),
    onSaveModel: (role: Role, choice: ModelChoice | null) => saveModel(env, role, choice),
    onSaveStageModel: (stage: Stage, choice: ModelChoice | null) => saveStageModel(env, stage, choice),
    onSaveLimit: (values: FormValues) => saveLimit(env, values),
    onSaveCheckLimits: (values: FormValues) => saveCheckLimits(env, values),
    onSaveCheck: (check: CheckSpec | undefined, values: FormValues) => saveCheck(env, check, values),
    onRemoveCheck: (check: CheckSpec) => removeCheckItem(env, check),
    onCancel: () => env.setTask(null),
  };
}

/** The props of the Checks tab. */
function checksPageProps(env: AiEnv, idle: boolean): AiChecksPageProps {
  return {
    settings: env.settings.data,
    idle,
    cursor: env.checkCursor,
    onLimits: () => env.setTask({ kind: "checkLimits" }),
    onAdd: () => env.setTask({ kind: "check" }),
    onCheck: (index) => openCheck(env, index),
  };
}

/**
 * The AI settings of the factory, in four tabs. `←/→` or a click changes the tab.
 * - Providers: the signed-in providers of Pi. `d` asks before it signs out, and `n` opens the page that signs in
 *   to another provider. On that page, `enter` signs in and `esc` goes back.
 * - Models: the models of the supervisor and of the workers. `s` and `w` change them. Under them, `↑/↓` select a
 *   Stage, and `enter` or a click changes the worker model override of the Stage.
 * - Limits: the worker limit. `l` changes it.
 * - Checks: the check limits and the checks that the factory runs for its workers. `c` changes the limits, `n` adds
 *   a check, `↑/↓` select a check, `enter` or a click edits it, and `d` asks before it removes it.
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
          stages={model.stages.data}
          stageCursor={env.stageCursor}
          onStage={(index) => openStageModel(env, index)}
        />
      )}
      {page === "limits" && (
        <AiLimitsPage settings={settings.data} idle={idle} onLimit={() => env.setTask({ kind: "limit" })} />
      )}
      {page === "checks" && <AiChecksPage {...checksPageProps(env, idle)} />}
      <AiTaskView
        task={model.task}
        ctx={ctx}
        runtime={model.runtime.data}
        provider={model.provider}
        status={model.status.data}
        settings={settings.data}
        {...taskHandlers(env)}
      />
    </Box>
  );
}
