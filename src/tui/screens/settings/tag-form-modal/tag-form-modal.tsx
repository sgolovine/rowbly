import type { TagConfig } from "../../../../services/config/config.js";
import { addTag, updateTag } from "../../../../services/tag/tag.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { EntityFormModal, type FormField, type FormValues } from "../../../components/index.js";

const LABEL_FIELD: FormField = { name: "label", label: "Label", kind: "text", required: true };
const VALUE_FIELD: FormField = { name: "value", label: "Value", kind: "text", required: true };

/** Adds the tag, or changes the label of `tag`. The service checks the values. */
function saveTag(ctx: ServiceContext, values: FormValues, tag: TagConfig | undefined): Promise<TagConfig> {
  const label = String(values.label ?? "");

  return tag ? updateTag({ value: tag.value, label }, ctx) : addTag({ label, value: String(values.value ?? "") }, ctx);
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
  return (
    <EntityFormModal
      noun="Tag"
      existing={tag}
      titleOf={(existing) => existing.value}
      fields={tag ? [LABEL_FIELD] : [LABEL_FIELD, VALUE_FIELD]}
      initialValues={tag ? { label: tag.label } : { label: "", value: "" }}
      save={(values, existing) => saveTag(ctx, values, existing)}
      labelOf={(saved) => saved.label}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
}
