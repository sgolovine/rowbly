import { createStage, type Stage, updateStage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { EntityFormModal, type FormValues } from "../../../components/index.js";

/** Creates the Stage, or updates `stage`, with the values of the form. */
function saveStage(ctx: ServiceContext, values: FormValues, stage: Stage | undefined): Promise<Stage> {
  const input = {
    label: String(values.label ?? ""),
    enabled: values.enabled === true,
    prompt: String(values.prompt ?? ""),
  };

  return stage ? updateStage({ key: stage.key, ...input }, ctx) : createStage(input, ctx);
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
  return (
    <EntityFormModal
      noun="Stage"
      existing={stage}
      titleOf={(existing) => existing.label}
      fields={[
        { name: "label", label: "Name", kind: "text", required: true },
        { name: "enabled", label: "Status", kind: "switch", switchLabels: { on: "Enabled", off: "Disabled" } },
        { name: "prompt", label: "Prompt", kind: "multiline" },
      ]}
      initialValues={{ label: stage?.label ?? "", enabled: stage?.enabled ?? true, prompt: stage?.prompt ?? "" }}
      save={(values, existing) => saveStage(ctx, values, existing)}
      labelOf={(saved) => saved.label}
      verb="Created"
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}
