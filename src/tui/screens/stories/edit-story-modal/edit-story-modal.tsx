import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { CustomField } from "../../../../services/config/config.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { deleteStory, type Story, updateStory } from "../../../../services/story/story.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { type ToastStore, useToast } from "../../../hooks/index.js";
import { deleteStoryMessage } from "../delete-story-message.js";
import { customFieldInput, customFormValue, storyFormFields } from "../story-form.js";
import { StoryModal } from "../story-modal/index.js";
import { toastInfo } from "../toast-info.js";

/** The environment of the save and the delete of the Story. */
interface EditStoryEnv {
  readonly ctx: ServiceContext;
  readonly story: Story;
  readonly customFields: readonly CustomField[];
  readonly toast: ToastStore;
  readonly onSaved: (story: Story) => void;
  readonly onDeleted: (id: string) => void;
}

/** Saves the values of the form and the pasted images to the Story. */
async function saveStory(env: EditStoryEnv, values: FormValues, attachments?: readonly PendingImage[]): Promise<void> {
  const saved = await updateStory(
    {
      attachments,
      id: env.story.id,
      title: String(values.title ?? ""),
      stage: typeof values.stage === "string" ? values.stage : undefined,
      description: String(values.description ?? ""),
      fields: customFieldInput(env.customFields, values),
    },
    env.ctx,
  );

  toastInfo(env.toast, `Saved ${saved.id}`);
  env.onSaved(saved);
}

/** Deletes the Story, and shows a failure as a toast. */
function removeStory(env: EditStoryEnv): Promise<void> {
  return deleteStory({ id: env.story.id }, env.ctx).then(
    ({ id }) => storyDeleted(env, id),
    (err: unknown) => env.toast.error(err),
  );
}

function storyDeleted(env: EditStoryEnv, id: string): void {
  toastInfo(env.toast, `Deleted ${id}`);
  env.onDeleted(id);
}

/** The values of the form: the fields of the Story and its custom field values. */
function initialValues(story: Story, customFields: readonly CustomField[]): FormValues {
  return {
    title: story.title,
    stage: story.stage,
    description: story.description,
    ...Object.fromEntries(customFields.map((f) => [f.key, customFormValue(f, story.fields[f.key] ?? null)])),
  };
}

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

  const env: EditStoryEnv = { ctx, story, customFields, toast, onSaved, onDeleted };
  const stageNames = Object.fromEntries(stages.map((stage) => [stage.key, stage.label]));

  return (
    <StoryModal
      ctx={ctx}
      storyId={story.id}
      stages={stageNames}
      specs={specs}
      title={`Edit ${story.id}`}
      fields={storyFormFields(stages, customFields)}
      initialValues={initialValues(story, customFields)}
      onSubmit={(values, attachments) => saveStory(env, values, attachments)}
      onClose={onClose}
      onDelete={{
        title: `Delete Story › ${story.id}`,
        message: deleteStoryMessage(story),
        onConfirm: () => removeStory(env),
      }}
    />
  );
}
