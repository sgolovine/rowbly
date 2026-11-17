import { useMemo, useState } from "react";
import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { CustomField, TagConfig } from "../../../../services/config/config.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { deleteStory, type Story, updateStory } from "../../../../services/story/story.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import { showToast, type ToastStore, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { deleteStoryMessage } from "../delete-story-message.js";
import type { StoryConfirm } from "../story-confirm-dialogs/index.js";
import { dependencyChoices, dependencyLists, dependsOnChanges, dependsOnValue } from "../story-dependency-view.js";
import { customFieldInput, customFormValue, storyFormFields } from "../story-form.js";
import { StoryModalBody } from "../story-modal-body/index.js";
import { tagChoices, tagsChange, tagsValue } from "../story-tag-view.js";

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
      ...dependsOnChanges(env.story.dependsOn, dependsOnValue(values.dependsOn)),
      ...tagsChange(env.story.tags, tagsValue(values.tags)),
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

/**
 * Opens a Story of the dependency lists by its ID, or `undefined` when the lists do not open Stories. An ID that the
 * Project does not have opens nothing.
 */
function dependencyOpener(
  stories: readonly Story[],
  onOpenStory: ((story: Story) => void) | undefined,
  clickable: boolean,
): ((id: string) => void) | undefined {
  if (!onOpenStory || !clickable) {
    return undefined;
  }

  return (id) => openStoryById(stories, onOpenStory, id);
}

function openStoryById(stories: readonly Story[], onOpenStory: (story: Story) => void, id: string): void {
  const story = stories.find((s) => s.id === id);

  if (story) {
    onOpenStory(story);
  }
}

/** The values of the form: the fields of the Story and its custom field values. */
function initialValues(story: Story, customFields: readonly CustomField[]): FormValues {
  return {
    title: story.title,
    stage: story.stage,
    description: story.description,
    dependsOn: [...story.dependsOn],
    tags: [...story.tags],
    ...Object.fromEntries(customFields.map((f) => [f.key, customFormValue(f, story.fields[f.key] ?? null)])),
  };
}

/**
 * The form that edits a Story in the Story sidebar. General has the Story fields with `Depends on`, and the
 * `Depends on` and `Blocks` lists of the saved Story. Attachments has the
 * saved attachment files. Specs appears between these tabs when the Project has Specs on, and Threads is last.
 * The form keeps pasted images until save. The Delete Button and `ctrl+d` ask before they delete the Story.
 * `esc` calls `onBack`, and the form keeps its text. A click on an item of the dependency lists calls `onOpenStory`.
 */
export function EditStoryForm({
  ctx,
  story,
  stories,
  stages,
  customFields,
  tags,
  specs = false,
  compactThreads,
  timeZone,
  onSaved,
  onDeleted,
  onBack,
  onHints,
  onOpenStory,
  clickable = true,
}: {
  ctx: ServiceContext;
  story: Story;
  /** The Stories of the Project, for the `Depends on` picker and the dependency lists. */
  stories: readonly Story[];
  stages: readonly Stage[];
  customFields: readonly CustomField[];
  /** The tags of the project, for the `Tags` field. */
  tags: readonly TagConfig[];
  /** The project has Specs on. */
  specs?: boolean;
  /** Each thread of the Threads tab uses one line. */
  compactThreads?: boolean;
  /** The time zone of the Created and Updated times. `undefined` is the time zone of the system. */
  timeZone?: string;
  onSaved(story: Story): void;
  onDeleted(id: string): void;
  /** `esc`: the Story sidebar gives the focus to the Story list. */
  onBack(): void;
  /** The keys of the tab on the screen. */
  onHints(hints: readonly KeyHint[]): void;
  /** A click on an item of the `Depends on` or `Blocks` list: opens that Story. */
  onOpenStory?(story: Story): void;
  /** The Story sidebar takes the mouse. */
  clickable?: boolean;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<StoryConfirm>(null);
  const choices = useMemo(
    () => dependencyChoices(stories, story.id, story.dependsOn),
    [stories, story.id, story.dependsOn],
  );

  const env: EditStoryEnv = { ctx, story, customFields, toast, onSaved, onDeleted };
  const stageNames = Object.fromEntries(stages.map((stage) => [stage.key, stage.label]));

  return (
    <StoryModalBody
      ctx={ctx}
      storyId={story.id}
      stages={stageNames}
      specs={specs}
      compactThreads={compactThreads}
      fields={storyFormFields(stages, customFields, choices, tagChoices(tags, story.tags))}
      initialValues={initialValues(story, customFields)}
      dependencies={dependencyLists(stories, stages, story.id, story.dependsOn)}
      times={{ createdAt: story.createdAt, updatedAt: story.updatedAt, timeZone }}
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
      onOpenStory={dependencyOpener(stories, onOpenStory, clickable)}
    />
  );
}
