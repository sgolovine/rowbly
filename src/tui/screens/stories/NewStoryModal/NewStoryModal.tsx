import type { CustomField } from "../../../../services/config/config.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { createStory, type Story } from "../../../../services/story/story.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { useToast } from "../../../hooks/index.js";
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
  const submit = async (values: FormValues) => {
    const story = await createStory(
      {
        title: String(values.title ?? ""),
        stage: typeof values.stage === "string" ? values.stage : undefined,
        description: String(values.description ?? ""),
        fields: customFieldInput(customFields, values),
      },
      ctx,
    );
    toast.push("info", `Created ${story.id}`);
    onCreated(story);
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
    />
  );
}
