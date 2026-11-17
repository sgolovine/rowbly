import { setPrompt, type UserPrompt } from "../../../../services/prompts/prompts.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { EntityFormModal, type FormValues } from "../../../components/index.js";

/** Replaces the text of `prompt` with the value of the form. */
function savePrompt(ctx: ServiceContext, values: FormValues, prompt: UserPrompt): Promise<UserPrompt> {
  return setPrompt({ name: prompt.name, text: String(values.text ?? "") }, ctx);
}

/**
 * Edits one user prompt in a generic Modal, in a Markdown `TextArea` (`ctrl+f` opens it full screen).
 * An empty prompt is valid: the factory then leaves the prompt out of its messages.
 */
export function PromptFormModal({
  ctx,
  prompt,
  onSaved,
  onClose,
}: {
  ctx: ServiceContext;
  prompt: UserPrompt;
  onSaved(prompt: UserPrompt): void;
  onClose(): void;
}) {
  return (
    <EntityFormModal
      noun="Prompt"
      existing={prompt}
      titleOf={(existing) => existing.label}
      fields={[{ name: "text", label: "Prompt", kind: "multiline" }]}
      initialValues={{ text: prompt.text }}
      save={(values) => savePrompt(ctx, values, prompt)}
      labelOf={(saved) => `the ${saved.label} prompt`}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}
