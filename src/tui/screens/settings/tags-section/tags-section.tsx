import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { TagConfig } from "../../../../services/config/config.js";
import { listTags, removeTag } from "../../../../services/tag/tag.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, ConfirmDialog, Loading } from "../../../components/index.js";
import {
  type AsyncState,
  showToast,
  type ToastStore,
  useAsync,
  useCursor,
  useIsActive,
  useKeyHints,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { columnWidth } from "../column-width.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { TagFormModal } from "../tag-form-modal/index.js";
import { TagRow } from "../tag-row/index.js";

type Mode =
  | { readonly kind: "list" }
  | { readonly kind: "new" }
  | { readonly kind: "edit"; readonly tag: TagConfig }
  | { readonly kind: "remove"; readonly tag: TagConfig };

/** What the handlers of the section read and change. */
interface TagsEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly list: AsyncState<TagConfig[]>;
  readonly current: TagConfig | undefined;
  readonly setMode: Dispatch<SetStateAction<Mode>>;
  readonly setCursor: (index: number) => void;
  readonly onChange: () => void;
}

function tagsHints(idle: boolean, current: TagConfig | undefined): KeyHint[] {
  if (!idle) {
    return [];
  }

  return [
    { key: "↑/↓", description: "select" },
    { key: "n", description: "new Tag" },
    ...(current
      ? [
          { key: "enter", description: "edit" },
          { key: "d", description: "remove" },
        ]
      : []),
  ];
}

/** Goes back to the list and reads the tags again, also in the screens behind Settings. */
function done(env: TagsEnv): void {
  env.setMode({ kind: "list" });
  env.list.reload();
  env.onChange();
}

function tagKey(env: TagsEnv, input: string, key: Key): void {
  if (input === "n") {
    env.setMode({ kind: "new" });

    return;
  }

  if (env.current && (key.return || input === "e")) {
    env.setMode({ kind: "edit", tag: env.current });

    return;
  }

  if (env.current && input === "d") {
    env.setMode({ kind: "remove", tag: env.current });
  }
}

function openTag(env: TagsEnv, index: number, tag: TagConfig): void {
  env.setCursor(index);
  env.setMode({ kind: "edit", tag });
}

/** Removes the tag from the project and from each Story. A failure goes back to the list. */
function removeOne(env: TagsEnv, tag: TagConfig): void {
  removeTag({ value: tag.value }, env.ctx).then(
    () => removed(env, tag),
    (err: unknown) => removeFailed(env, err),
  );
}

function removed(env: TagsEnv, tag: TagConfig): void {
  showToast(env.toast, "info", `Removed ${tag.label}`);
  done(env);
}

function removeFailed(env: TagsEnv, err: unknown): void {
  env.toast.error(err);
  env.setMode({ kind: "list" });
}

/**
 * The tags of the project. `n` or the **+ New Tag** Button adds a tag, `enter` or `e` edits the label
 * of the selected tag, as a click on its row does, and `d` removes it from the project and from each
 * Story after a confirmation.
 */
export function TagsSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const list = useAsync(() => listTags(ctx), [ctx]);
  const tags = list.data ?? [];
  const idle = active && mode.kind === "list";
  const [cursor, setCursor] = useCursor(tags.length, idle);

  const current = tags[cursor];
  const env: TagsEnv = { ctx, toast, list, current, setMode, setCursor, onChange };

  useKeyHints(tagsHints(idle, current));
  useInput((input, key) => tagKey(env, input, key), { isActive: idle });

  if (!list.data) {
    return list.loading ? <Loading label="Loading Tags…" /> : null;
  }

  const labelWidth = columnWidth(tags.map((t) => t.label));

  return (
    <Box flexDirection="column">
      {tags.length === 0 && <Text color={theme.inkFaint}>No Tags. Press n to add one.</Text>}
      {tags.map((tag, i) => (
        <TagRow
          key={tag.value}
          tag={tag}
          selected={i === cursor}
          active={idle}
          labelWidth={labelWidth}
          onClick={() => openTag(env, i, tag)}
        />
      ))}
      <Box marginTop={1}>
        <Button label="+ New Tag" keyName="n" onClick={() => setMode({ kind: "new" })} clickable={idle} compact />
      </Box>
      {(mode.kind === "new" || mode.kind === "edit") && (
        <TagFormModal
          ctx={ctx}
          tag={mode.kind === "edit" ? mode.tag : undefined}
          onClose={() => setMode({ kind: "list" })}
          onSaved={() => done(env)}
        />
      )}
      {mode.kind === "remove" && (
        <ConfirmDialog
          title={`Remove Tag › ${mode.tag.value}`}
          message={`Remove ${mode.tag.label}? Rowbly also removes the tag from each Story.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => removeOne(env, mode.tag)}
          onCancel={() => setMode({ kind: "list" })}
        />
      )}
    </Box>
  );
}
