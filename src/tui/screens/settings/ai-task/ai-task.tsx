import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import type { FactorySettings, ModelChoice } from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConfirmDialog, FormModal, type FormValues } from "../../../components/index.js";
import type { AiProvider, AiStatus, AiTask, Role } from "../ai-view.js";
import { AuthFlow } from "../auth-flow/index.js";
import { ModelPickerModal, NO_OVERRIDE_LABEL } from "../model-picker-modal/index.js";

/** The props of `AiTaskView`. */
export interface AiTaskViewProps {
  readonly task: AiTask;
  readonly ctx: ServiceContext;
  readonly runtime: AuthRuntime | undefined;
  /** The selected provider. */
  readonly provider: AiProvider | undefined;
  readonly status: AiStatus | undefined;
  readonly settings: FactorySettings | undefined;
  /** The sign-in ended: `true` when it completed. */
  readonly onSignInDone: (signedIn: boolean) => void;
  readonly onSignOut: (id: string) => void;
  readonly onSaveModel: (role: Role, choice: ModelChoice | null) => Promise<void>;
  /** `null` removes the override of the Stage. */
  readonly onSaveStageModel: (stage: Stage, choice: ModelChoice | null) => Promise<void>;
  readonly onSaveLimit: (values: FormValues) => Promise<void>;
  readonly onCancel: () => void;
}

/** The task on top of the AI settings: a sign-in, a sign-out confirmation, a model picker for a role or a Stage, or the worker limit. */
export function AiTaskView({ task, ctx, runtime, provider, status, settings, ...on }: AiTaskViewProps) {
  return (
    <>
      {task?.kind === "signIn" && runtime && provider && (
        <AuthFlow
          ctx={ctx}
          runtime={runtime}
          provider={provider.id}
          methods={provider.methods}
          onDone={(signedIn) => on.onSignInDone(signedIn)}
        />
      )}
      {task?.kind === "signOut" && provider && (
        <ConfirmDialog
          title={`AI › Sign out › ${provider.id}`}
          message={`Sign out of ${provider.id}? Pi removes its stored credential on this computer. A running factory cannot use this provider after it.`}
          confirmLabel="Sign out"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => on.onSignOut(provider.id)}
          onCancel={on.onCancel}
        />
      )}
      {task?.kind === "model" && status && (
        <ModelPickerModal
          title={`AI › ${task.role === "supervisor" ? "Supervisor" : "Worker"} model`}
          models={status.models}
          current={task.role === "supervisor" ? settings?.supervisorModel : settings?.workerModel}
          onSave={(choice) => on.onSaveModel(task.role, choice)}
          onClose={on.onCancel}
        />
      )}
      {task?.kind === "stageModel" && status && (
        <ModelPickerModal
          title={`AI › Worker model › ${task.stage.label}`}
          models={status.models}
          current={settings?.stageWorkerModels?.[task.stage.key]}
          defaultLabel={NO_OVERRIDE_LABEL}
          onSave={(choice) => on.onSaveStageModel(task.stage, choice)}
          onClose={on.onCancel}
        />
      )}
      {task?.kind === "limit" && (
        <FormModal
          title="AI › Worker limit"
          fields={[{ name: "maxWorkers", label: "Worker limit", kind: "number", required: true }]}
          initialValues={{ maxWorkers: settings?.maxWorkers ?? 4 }}
          submitOnEnter
          onSubmit={on.onSaveLimit}
          onClose={on.onCancel}
        />
      )}
    </>
  );
}
