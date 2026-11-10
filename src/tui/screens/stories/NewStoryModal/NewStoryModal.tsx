import { useRef, useState } from "react";
import type { CustomField } from "../../../../services/config/config.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { createStory, type Story } from "../../../../services/story/story.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { IMAGE_PASTE_HINT, type useStoryPaste, useToast } from "../../../hooks/index.js";
import { NewStoryImages } from "../NewStoryImages/index.js";
import { customFieldInput, customFormValue, storyFormFields } from "../storyForm.js";

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
  const paste = useRef<ReturnType<typeof useStoryPaste> | null>(null);
  const submit = async (values: FormValues) => {
    if (paste.current?.busy) return;
    setSaving(true);
    try {
      const story = await createStory(
        {
          attachments: paste.current?.pending,
          title: String(values.title ?? ""),
          stage: typeof values.stage === "string" ? values.stage : undefined,
          description: String(values.description ?? ""),
          fields: customFieldInput(customFields, values),
        },
        ctx,
      );
      paste.current?.saved();
      toast.push("info", `Created ${story.id}`);
      onCreated(story);
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormModal
      title="New Story"
      fields={storyFormFields(stages, customFields)}
      initialValues={{
        title: "",
        stage: stage ?? stages[0]?.key ?? null,
        description: "",
        ...Object.fromEntries(customFields.map((f) => [f.key, customFormValue(f, null)])),
      }}
      onSubmit={submit}
      onClose={onClose}
      extraHints={[IMAGE_PASTE_HINT]}
    >
      <NewStoryImages
        enabled={!saving}
        onPaste={(value) => {
          paste.current = value;
        }}
      />
    </FormModal>
  );
}
