import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { CustomField } from "../../../../services/config/config.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { deleteStory, type Story, updateStory } from "../../../../services/story/story.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { useToast } from "../../../hooks/index.js";
import { deleteStoryMessage } from "../deleteStoryMessage.js";
import { StoryModal } from "../StoryModal/index.js";
import { customFieldInput, customFormValue, storyFormFields } from "../storyForm.js";

/**
 * Edits the Story in a screen Modal. General has the Story fields, and Attachments has the saved PNG images.
 * Specs appears between these tabs when the Project has Specs on. The form keeps pasted images until save.
 * The Delete Button and `ctrl+d` ask before they delete the Story.
 */
export function EditStoryModal({
  ctx,
  story,
  stages,
  customFields,
  specs = false,
  onSaved,
  onDeleted,
  onClose,
}: {
  ctx: ServiceContext;
  story: Story;
  stages: readonly Stage[];
  customFields: readonly CustomField[];
  /** The project has Specs on. */
  specs?: boolean;
  onSaved(story: Story): void;
  onDeleted(id: string): void;
  onClose(): void;
}) {
  const toast = useToast();
  const submit = async (values: FormValues, attachments?: readonly PendingImage[]) => {
    const saved = await updateStory(
      {
        attachments,
        id: story.id,
        title: String(values.title ?? ""),
        stage: typeof values.stage === "string" ? values.stage : undefined,
        description: String(values.description ?? ""),
        fields: customFieldInput(customFields, values),
      },
      ctx,
    );
    toast.push("info", `Saved ${saved.id}`);
    onSaved(saved);
  };
  const remove = () =>
    deleteStory({ id: story.id }, ctx).then(
      ({ id }) => {
        toast.push("info", `Deleted ${id}`);
        onDeleted(id);
      },
      (err: unknown) => toast.error(err),
    );
  const form = {
    title: `Edit ${story.id}`,
    fields: storyFormFields(stages, customFields),
    initialValues: {
      title: story.title,
      stage: story.stage,
      description: story.description,
      ...Object.fromEntries(customFields.map((f) => [f.key, customFormValue(f, story.fields[f.key] ?? null)])),
    },
    onSubmit: submit,
    onClose,
    onDelete: {
      title: `Delete Story › ${story.id}`,
      message: deleteStoryMessage(story),
      onConfirm: remove,
    },
  };
  return <StoryModal ctx={ctx} storyId={story.id} specs={specs} {...form} />;
}
