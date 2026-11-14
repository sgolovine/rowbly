import { useState } from "react";
import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { CustomField } from "../../../../services/config/config.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { deleteStory, type Story, updateStory } from "../../../../services/story/story.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { showToast, type ToastStore, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { deleteStoryMessage } from "../delete-story-message.js";
import type { StoryConfirm } from "../story-confirm-dialogs/index.js";
import { customFieldInput, customFormValue, storyFormFields } from "../story-form.js";
import { StoryModalBody } from "../story-modal-body/index.js";

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

  showToast(env.toast, "info", `Saved ${saved.id}`);
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
  showToast(env.toast, "info", `Deleted ${id}`);
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
 * The form that edits a Story in the Story sidebar. General has the Story fields, and Attachments has the
 * saved PNG images. Specs appears between these tabs when the Project has Specs on, and Threads is last.
 * The form keeps pasted images until save. The Delete Button and `ctrl+d` ask before they delete the Story.
 * `esc` calls `onBack`, and the form keeps its text.
 */
export function EditStoryForm({
  ctx,
  story,
  stages,
  customFields,
  specs = false,
  onSaved,
  onDeleted,
  onBack,
  onHints,
}: {
  ctx: ServiceContext;
  story: Story;
  stages: readonly Stage[];
  customFields: readonly CustomField[];
  /** The project has Specs on. */
  specs?: boolean;
  onSaved(story: Story): void;
  onDeleted(id: string): void;
  /** `esc`: the Story sidebar gives the focus to the Story list. */
  onBack(): void;
  /** The keys of the tab on the screen. */
  onHints(hints: readonly KeyHint[]): void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<StoryConfirm>(null);

  const env: EditStoryEnv = { ctx, story, customFields, toast, onSaved, onDeleted };
  const stageNames = Object.fromEntries(stages.map((stage) => [stage.key, stage.label]));

  return (
    <StoryModalBody
      ctx={ctx}
      storyId={story.id}
      stages={stageNames}
      specs={specs}
      fields={storyFormFields(stages, customFields)}
      initialValues={initialValues(story, customFields)}
      onSubmit={(values, attachments) => saveStory(env, values, attachments)}
      onRequestClose={onBack}
      onDelete={{
        title: `Delete Story › ${story.id}`,
        message: deleteStoryMessage(story),
        onConfirm: () => removeStory(env),
      }}
      confirming={confirming}
      onConfirming={setConfirming}
      onHints={onHints}
    />
  );
}
