import { setPrompt, type UserPrompt } from "../../../../services/prompts/prompts.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { showToast, type ToastStore, useToast } from "../../../hooks/index.js";

/** The environment of the save of the prompt. */
interface PromptFormEnv {
  readonly ctx: ServiceContext;
  readonly prompt: UserPrompt;
  readonly toast: ToastStore;
  readonly onSaved: (prompt: UserPrompt) => void;
}

/** Replaces the text of the prompt with the value of the form. */
async function savePrompt(env: PromptFormEnv, values: FormValues): Promise<void> {
  const saved = await setPrompt({ name: env.prompt.name, text: String(values.text ?? "") }, env.ctx);

  showToast(env.toast, "info", `Updated the ${saved.label} prompt`);
  env.onSaved(saved);
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
  const toast = useToast();

  const env: PromptFormEnv = { ctx, prompt, toast, onSaved };

  return (
    <FormModal
      title={`Edit Prompt › ${prompt.label}`}
      fields={[{ name: "text", label: "Prompt", kind: "multiline" }]}
      initialValues={{ text: prompt.text }}
      onSubmit={(values) => savePrompt(env, values)}
      onClose={onClose}
    />
  );
}
