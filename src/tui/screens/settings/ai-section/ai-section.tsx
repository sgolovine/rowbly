import { Box, Text } from "ink";
import { type AuthRuntime, authRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { DetailView } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { AiButtons } from "../ai-buttons/index.js";
import { AiProviders } from "../ai-providers/index.js";
import { AiTaskView } from "../ai-task/index.js";
import { modelText } from "../ai-view.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { finishTask, pickProvider, reloadAll, saveLimit, saveModel, signOut } from "./ai-actions.js";
import { useAiSection } from "./use-ai-section.js";

/**
 * The AI settings of the factory: the AI providers of Pi and their sign-in, the models of the supervisor and
 * the workers, and the worker limit. `enter` signs in to the selected provider, and `d` asks before it signs
 * out. `s` and `w` select the model of the supervisor and of the workers, and `l` changes the worker limit.
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

  const { env, idle, ready, settings } = model;

  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: "Supervisor", value: modelText(settings.data?.supervisorModel) },
          { label: "Workers", value: modelText(settings.data?.workerModel) },
          { label: "Worker limit", value: settings.data ? String(settings.data.maxWorkers) : "—" },
        ]}
      />
      <AiProviders
        loading={model.loading}
        ready={ready}
        providers={env.providers}
        idle={idle}
        height={model.layout.height}
        onHighlight={env.setSelected}
        onSelect={(id) => pickProvider(env, id)}
        onFilteringChange={model.setFiltering}
      />
      <AiButtons
        canSignIn={model.canSignIn}
        canSignOut={model.canSignOut}
        ready={ready}
        idle={idle}
        onSignIn={() => env.setTask({ kind: "signIn" })}
        onSignOut={() => env.setTask({ kind: "signOut" })}
        onModel={(role) => env.setTask({ kind: "model", role })}
        onLimit={() => env.setTask({ kind: "limit" })}
        onReload={() => reloadAll(env)}
      />
      <Text color={theme.inkFaint} wrap="wrap">
        The sign-in is for this computer. Pi keeps the credentials; the Project keeps no secret. A configured provider
        is not a check of the account.
      </Text>
      <AiTaskView
        task={model.task}
        ctx={ctx}
        runtime={model.runtime.data}
        provider={model.provider}
        status={model.status.data}
        settings={settings.data}
        onSignInDone={(signedIn) => finishTask(env, signedIn)}
        onSignOut={(id) => signOut(env, id)}
        onSaveModel={(role, choice) => saveModel(env, role, choice)}
        onSaveLimit={(values) => saveLimit(env, values)}
        onCancel={() => env.setTask(null)}
      />
    </Box>
  );
}
