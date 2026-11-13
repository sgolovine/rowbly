import { Box, Text, useInput } from "ink";
import { useState } from "react";
import {
  type AuthRuntime,
  authRuntime,
  getAuthStatus,
  listAvailableModels,
  logoutProvider,
} from "../../../../services/agentAuth/agentAuth.js";
import { ValidationError } from "../../../../services/errors/errors.js";
import {
  getFactorySettings,
  type ModelChoice,
  updateFactorySettings,
} from "../../../../services/factorySettings/factorySettings.js";
import { Button, ConfirmDialog, DetailView, FormModal, Loading, SelectList } from "../../../components/index.js";
import { ActiveContext, useAsync, useIsActive, useKeyHints, useLayout, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { AuthFlow } from "../AuthFlow/index.js";
import { ModelPickerModal } from "../ModelPickerModal/index.js";
import type { SettingsSectionProps } from "../settingsSections.js";

type Role = "supervisor" | "worker";
type Task = { kind: "signIn" } | { kind: "signOut" } | { kind: "model"; role: Role } | { kind: "limit" } | null;

/** One provider row: its status, from its stored credential or from a key in the environment. */
function providerStatus(provider: { configured: boolean; credentialType?: string }): string {
  if (provider.credentialType === "oauth") return "signed in with an account";
  if (provider.credentialType === "api_key") return "signed in with an API key";
  if (provider.configured) return "configured outside Rowbly";
  return "not signed in";
}

/** `provider/model`, with its thinking level, or `Pi default`. */
function modelText(choice: ModelChoice | undefined): string {
  if (!choice) return "Pi default";
  return `${choice.provider}/${choice.modelId}${choice.thinkingLevel ? ` · thinking ${choice.thinkingLevel}` : ""}`;
}

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
  const active = useIsActive();
  const layout = useLayout();
  const toast = useToast();
  const [task, setTask] = useState<Task>(null);
  const [selected, setSelected] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const runtime = useAsync(loadRuntime, [loadRuntime]);
  const status = useAsync(async () => {
    if (!runtime.data) return undefined;
    const [providers, models] = await Promise.all([getAuthStatus(runtime.data), listAvailableModels(runtime.data)]);
    return { providers, models };
  }, [runtime.data]);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);
  const providers = status.data?.providers ?? [];
  const provider = providers.find((p) => p.id === selected) ?? providers[0];
  const ready = runtime.data !== undefined && status.data !== undefined;
  const idle = active && task === null;
  const canSignIn = ready && provider !== undefined && provider.methods.length > 0;
  const canSignOut = ready && provider?.credentialType !== undefined;

  const reload = () => {
    status.reload();
    settings.reload();
  };
  const finish = (changed: boolean) => {
    setTask(null);
    if (changed) {
      reload();
      onChange();
    }
  };
  const saveModel = async (role: Role, choice: ModelChoice | null) => {
    await updateFactorySettings({ [`${role}Model`]: choice ?? undefined }, ctx);
    toast.push("info", `Saved the ${role} model: ${modelText(choice ?? undefined)}`);
    finish(true);
  };
  const signOut = (id: string) => {
    if (!runtime.data) return;
    logoutProvider(runtime.data, id).then(
      () => {
        toast.push("info", `Signed out of ${id}`);
        finish(true);
      },
      (error: unknown) => {
        toast.error(error);
        setTask(null);
      },
    );
  };

  useKeyHints(
    idle
      ? [
          ...(providers.length > 0
            ? [
                { key: "↑/↓", description: "select" },
                { key: "/", description: "filter" },
              ]
            : []),
          ...(canSignIn ? [{ key: "enter", description: "sign in" }] : []),
          ...(canSignOut ? [{ key: "d", description: "sign out" }] : []),
          ...(ready
            ? [
                { key: "s", description: "supervisor model" },
                { key: "w", description: "worker model" },
              ]
            : []),
          { key: "l", description: "worker limit" },
          { key: "r", description: "reload" },
        ]
      : [],
  );
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) return;
      // The provider list takes `enter`: its `onSelect` starts the sign-in.
      if (input === "d" && canSignOut) setTask({ kind: "signOut" });
      else if (input === "s" && ready) setTask({ kind: "model", role: "supervisor" });
      else if (input === "w" && ready) setTask({ kind: "model", role: "worker" });
      else if (input === "l") setTask({ kind: "limit" });
      else if (input === "r") {
        runtime.reload();
        settings.reload();
      }
    },
    { isActive: idle && !filtering },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: "Supervisor", value: modelText(settings.data?.supervisorModel) },
          { label: "Workers", value: modelText(settings.data?.workerModel) },
          { label: "Worker limit", value: settings.data ? String(settings.data.maxWorkers) : "—" },
        ]}
      />
      {runtime.loading || (runtime.data && status.loading) ? (
        <Loading label="Loading the AI providers…" />
      ) : !ready ? (
        <Text color={theme.inkFaint}>Rowbly cannot load the AI providers. Press r to try again.</Text>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.inkMuted}>Providers</Text>
          <ActiveContext.Provider value={idle}>
            <SelectList
              items={providers.map((p) => ({
                value: p.id,
                label: p.id,
                description: providerStatus(p),
              }))}
              emptyText="Pi has no AI providers."
              limit={Math.max(1, Math.min(8, (layout.height ?? 24) - 12))}
              onHighlight={(item) => setSelected(item?.value)}
              onSelect={(item) => {
                setSelected(item.value);
                const chosen = providers.find((p) => p.id === item.value);
                if (chosen && chosen.methods.length > 0) setTask({ kind: "signIn" });
              }}
              onFilteringChange={setFiltering}
            />
          </ActiveContext.Provider>
        </Box>
      )}
      <Box flexWrap="wrap" gap={1}>
        {canSignIn && (
          <Button
            label="Sign in"
            keyName="enter"
            compact
            clickable={idle}
            onClick={() => setTask({ kind: "signIn" })}
          />
        )}
        {canSignOut && (
          <Button
            label="Sign out"
            keyName="d"
            compact
            destructive
            clickable={idle}
            onClick={() => setTask({ kind: "signOut" })}
          />
        )}
        {ready && (
          <>
            <Button
              label="Supervisor model"
              keyName="s"
              compact
              clickable={idle}
              onClick={() => setTask({ kind: "model", role: "supervisor" })}
            />
            <Button
              label="Worker model"
              keyName="w"
              compact
              clickable={idle}
              onClick={() => setTask({ kind: "model", role: "worker" })}
            />
          </>
        )}
        <Button label="Worker limit" keyName="l" compact clickable={idle} onClick={() => setTask({ kind: "limit" })} />
        <Button
          label="Reload"
          keyName="r"
          compact
          clickable={idle}
          onClick={() => {
            runtime.reload();
            settings.reload();
          }}
        />
      </Box>
      <Text color={theme.inkFaint} wrap="wrap">
        The sign-in is for this computer. Pi keeps the credentials; the Project keeps no secret. A configured provider
        is not a check of the account.
      </Text>
      {task?.kind === "signIn" && runtime.data && provider && (
        <AuthFlow
          ctx={ctx}
          runtime={runtime.data}
          provider={provider.id}
          methods={provider.methods}
          onDone={(signedIn) => finish(signedIn)}
        />
      )}
      {task?.kind === "signOut" && provider && (
        <ConfirmDialog
          title={`AI › Sign out › ${provider.id}`}
          message={`Sign out of ${provider.id}? Pi removes its stored credential on this computer. A running factory cannot use this provider after it.`}
          confirmLabel="Sign out"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => signOut(provider.id)}
          onCancel={() => setTask(null)}
        />
      )}
      {task?.kind === "model" && status.data && (
        <ModelPickerModal
          title={`AI › ${task.role === "supervisor" ? "Supervisor" : "Worker"} model`}
          models={status.data.models}
          current={task.role === "supervisor" ? settings.data?.supervisorModel : settings.data?.workerModel}
          onSave={(choice) => saveModel(task.role, choice)}
          onClose={() => setTask(null)}
        />
      )}
      {task?.kind === "limit" && (
        <FormModal
          title="AI › Worker limit"
          fields={[{ name: "maxWorkers", label: "Worker limit", kind: "number", required: true }]}
          initialValues={{ maxWorkers: settings.data?.maxWorkers ?? 4 }}
          submitOnEnter
          onSubmit={async (values) => {
            const maxWorkers = values.maxWorkers;
            if (typeof maxWorkers !== "number" || !Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
              throw new ValidationError("Invalid worker limit", {
                details: { issues: [{ path: ["maxWorkers"], message: "must be a whole number from 1" }] },
              });
            await updateFactorySettings({ maxWorkers }, ctx);
            toast.push("info", `Saved the worker limit: ${maxWorkers}`);
            finish(true);
          }}
          onClose={() => setTask(null)}
        />
      )}
    </Box>
  );
}
