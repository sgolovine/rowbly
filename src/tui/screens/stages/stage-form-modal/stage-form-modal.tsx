import { createStage, type Stage, updateStage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { showToast, type ToastStore, useToast } from "../../../hooks/index.js";

/** The environment of the save of the Stage. */
interface StageFormEnv {
  readonly ctx: ServiceContext;
  /** The Stage to edit. Without it, the form creates a Stage. */
  readonly stage: Stage | undefined;
  readonly toast: ToastStore;
  readonly onSaved: (stage: Stage) => void;
}

/** Creates the Stage, or updates the edited Stage, with the values of the form. */
async function saveStage(env: StageFormEnv, values: FormValues): Promise<void> {
  const { ctx, stage } = env;
  const input = {
    label: String(values.label ?? ""),
    enabled: values.enabled === true,
    prompt: String(values.prompt ?? ""),
  };

  const saved = stage ? await updateStage({ key: stage.key, ...input }, ctx) : await createStage(input, ctx);

  showToast(env.toast, "info", stage ? `Updated ${saved.label}` : `Created ${saved.label}`);
  env.onSaved(saved);
}

/**
 * Creates a Stage, or edits `stage`, in a generic Modal: its name, whether it is enabled, and its prompt
 * for agents, in a Markdown `TextArea` (`ctrl+f` opens it full screen). Agents skip the Stories of a
 * disabled Stage, also when the Stage has a prompt.
 */
export function StageFormModal({
  ctx,
  stage,
  onSaved,
  onClose,
}: {
  ctx: ServiceContext;
  /** The Stage to edit. Without it, the form creates a Stage. */
  stage?: Stage;
  onSaved(stage: Stage): void;
  onClose(): void;
}) {
  const toast = useToast();

  const env: StageFormEnv = { ctx, stage, toast, onSaved };

  return (
    <FormModal
      title={stage ? `Edit Stage › ${stage.label}` : "New Stage"}
      fields={[
        { name: "label", label: "Name", kind: "text", required: true },
        { name: "enabled", label: "Status", kind: "switch", switchLabels: { on: "Enabled", off: "Disabled" } },
        { name: "prompt", label: "Prompt", kind: "multiline" },
      ]}
      initialValues={{ label: stage?.label ?? "", enabled: stage?.enabled ?? true, prompt: stage?.prompt ?? "" }}
      onSubmit={(values) => saveStage(env, values)}
      onClose={onClose}
    />
  );
}
