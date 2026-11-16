import type { TagConfig } from "../../../../services/config/config.js";
import { addTag, updateTag } from "../../../../services/tag/tag.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type FormField, FormModal, type FormValues } from "../../../components/index.js";
import { showToast, type ToastStore, useToast } from "../../../hooks/index.js";

/** What a save of the form reads. */
interface TagFormEnv {
  readonly ctx: ServiceContext;
  readonly tag: TagConfig | undefined;
  readonly toast: ToastStore;
  readonly onSaved: (tag: TagConfig) => void;
}

const LABEL_FIELD: FormField = { name: "label", label: "Label", kind: "text", required: true };
const VALUE_FIELD: FormField = { name: "value", label: "Value", kind: "text", required: true };

/** Adds the tag, or changes the label of the tag that the form edits. The service checks the values. */
async function saveTag(env: TagFormEnv, values: FormValues): Promise<void> {
  const label = String(values.label ?? "");

  const saved = env.tag
    ? await updateTag({ value: env.tag.value, label }, env.ctx)
    : await addTag({ label, value: String(values.value ?? "") }, env.ctx);

  showToast(env.toast, "info", env.tag ? `Updated ${saved.label}` : `Added ${saved.label}`);
  env.onSaved(saved);
}

/**
 * Adds a tag, or edits the label of `tag`, in a generic Modal. The value of a tag cannot change, so
 * the edit form has only the label, and its title shows the value.
 */
export function TagFormModal({
  ctx,
  tag,
  onSaved,
  onClose,
}: {
  ctx: ServiceContext;
  /** The tag to edit. Without it, the form adds a tag. */
  tag?: TagConfig;
  onSaved(tag: TagConfig): void;
  onClose(): void;
}) {
  const toast = useToast();

  const env: TagFormEnv = { ctx, tag, toast, onSaved };

  return (
    <FormModal
      title={tag ? `Edit Tag › ${tag.value}` : "New Tag"}
      fields={tag ? [LABEL_FIELD] : [LABEL_FIELD, VALUE_FIELD]}
      initialValues={tag ? { label: tag.label } : { label: "", value: "" }}
      onSubmit={(values) => saveTag(env, values)}
      onClose={onClose}
    />
  );
}
