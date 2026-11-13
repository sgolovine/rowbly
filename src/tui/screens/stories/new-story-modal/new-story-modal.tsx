import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";
import type { CustomField } from "../../../../services/config/config.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { createStory, type Story } from "../../../../services/story/story.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { IMAGE_PASTE_HINT, type ToastStore, type useStoryPaste, useToast, writeRef } from "../../../hooks/index.js";
import { NewStoryImages } from "../new-story-images/index.js";
import { customFieldInput, customFormValue, storyFormFields } from "../story-form.js";
import { toastInfo } from "../toast-info.js";

type StoryPaste = ReturnType<typeof useStoryPaste>;

/** The environment of the creation of the Story. */
interface NewStoryEnv {
  readonly ctx: ServiceContext;
  readonly customFields: readonly CustomField[];
  readonly toast: ToastStore;
  /** The paste state of the images, from `NewStoryImages`. */
  readonly paste: RefObject<StoryPaste | null>;
  readonly setSaving: Dispatch<SetStateAction<boolean>>;
  readonly onCreated: (story: Story) => void;
}

/** Creates the Story with the values of the form and the pasted images, unless a paste has not finished. */
async function createNewStory(env: NewStoryEnv, values: FormValues): Promise<void> {
  const { paste } = env;

  if (paste.current?.busy) {
    return;
  }

  env.setSaving(true);

  try {
    const story = await createStory(
      {
        attachments: paste.current?.pending,
        title: String(values.title ?? ""),
        stage: typeof values.stage === "string" ? values.stage : undefined,
        description: String(values.description ?? ""),
        fields: customFieldInput(env.customFields, values),
      },
      env.ctx,
    );

    paste.current?.saved();
    toastInfo(env.toast, `Created ${story.id}`);
    env.onCreated(story);
  } finally {
    env.setSaving(false);
  }
}

/** The values of an empty form, in the Stage `stage` or the first Stage. */
function initialValues(stages: readonly Stage[], customFields: readonly CustomField[], stage?: string): FormValues {
  return {
    title: "",
    stage: stage ?? stages[0]?.key ?? null,
    description: "",
    ...Object.fromEntries(customFields.map((f) => [f.key, customFormValue(f, null)])),
  };
}

/**
 * Creates a Story in a generic Modal: its title, its Stage, its description in a Markdown `TextArea`
 * (`ctrl+f` opens it full screen) and the custom fields of the project.
 */
export function NewStoryModal({
  ctx,
  stages,
  customFields,
  stage,
  onCreated,
  onClose,
}: {
  ctx: ServiceContext;
  stages: readonly Stage[];
  customFields: readonly CustomField[];
  /** The Stage the form starts with. Defaults to the first Stage. */
  stage?: string;
  onCreated(story: Story): void;
  onClose(): void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const paste = useRef<StoryPaste | null>(null);

  const env: NewStoryEnv = { ctx, customFields, toast, paste, setSaving, onCreated };

  return (
    <FormModal
      title="New Story"
      fields={storyFormFields(stages, customFields)}
      initialValues={initialValues(stages, customFields, stage)}
      onSubmit={(values) => createNewStory(env, values)}
      onClose={onClose}
      extraHints={[IMAGE_PASTE_HINT]}
    >
      <NewStoryImages enabled={!saving} onPaste={(value) => writeRef(paste, value)} />
    </FormModal>
  );
}
