import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { createSpec, deleteSpec, type Spec, unlinkSpec, updateSpec } from "../../../../services/spec/spec.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { FormValues } from "../../../components/index.js";
import type { ToastStore } from "../../../hooks/index.js";
import type { SpecMode } from "../spec-dialogs/index.js";
import { toastInfo } from "../toast-info.js";
import { listKeyMode } from "./specs-tab-view.js";
import type { SpecDrafts } from "./use-spec-drafts.js";

/** The environment of the handlers of the Specs tab. */
export interface SpecsTabEnv {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  readonly toast: ToastStore;
  readonly drafts: SpecDrafts;
  readonly current: Spec | undefined;
  readonly cursor: number;
  readonly setMode: Dispatch<SetStateAction<SpecMode>>;
  readonly setCursor: (index: number) => void;
  /** Selects the spec with this slug after the next reload of the list. */
  readonly setSelectSlug: Dispatch<SetStateAction<string | null>>;
  readonly reload: () => void;
}

/** Goes back to the list. */
export function showList(env: SpecsTabEnv): void {
  env.setMode({ kind: "list" });
}

/** The keys of the editor: `ctrl+s` saves the text at once, and `tab` goes back to the list. */
export function handleEditKey(env: SpecsTabEnv, input: string, key: Key): void {
  if (key.ctrl && input === "s") {
    env.drafts.flush();
  } else if (key.tab && !key.shift) {
    showList(env);
  }
}

/** The keys of the list: `n` creates, `enter` or `tab` edits, `r` renames and `d` removes the selected spec. */
export function handleListKey(env: SpecsTabEnv, input: string, key: Key): void {
  const mode = listKeyMode(env.current, input, key);

  if (mode) {
    env.setMode(mode);
  }
}

/** A click on the selected row edits the spec, and a click on another row selects it. */
export function clickRow(env: SpecsTabEnv, index: number): void {
  if (index === env.cursor) {
    env.setMode({ kind: "edit" });

    return;
  }

  env.setCursor(index);
  showList(env);
}

/** Creates a spec for the Story, and opens its text after the reload. */
export async function createStorySpec(env: SpecsTabEnv, values: FormValues): Promise<void> {
  const spec = await createSpec({ title: String(values.title ?? ""), stories: [env.storyId] }, env.ctx);

  toastInfo(env.toast, `Created ${spec.title}`);
  env.setSelectSlug(spec.slug);
  showList(env);
  env.reload();
}

/** Gives `spec` the title from the form. */
export async function renameStorySpec(env: SpecsTabEnv, spec: Spec, values: FormValues): Promise<void> {
  const renamed = await updateSpec({ slug: spec.slug, title: String(values.title ?? "") }, env.ctx);

  toastInfo(env.toast, `Renamed to ${renamed.title}`);
  showList(env);
  env.reload();
}

/** Removes `spec` from the Story, or deletes it when no other Story has it, after its last text is written. */
export async function removeStorySpec(env: SpecsTabEnv, spec: Spec): Promise<void> {
  const { ctx, storyId } = env;
  const shared = spec.stories.some((id) => id !== storyId);

  try {
    await env.drafts.forget(spec.slug);
    await (shared ? unlinkSpec({ slug: spec.slug, story: storyId }, ctx) : deleteSpec({ slug: spec.slug }, ctx));
    toastInfo(env.toast, shared ? `Removed ${spec.title} from ${storyId}` : `Deleted ${spec.title}`);
    showList(env);
    env.reload();
  } catch (err) {
    env.toast.error(err);
    showList(env);
  }
}
