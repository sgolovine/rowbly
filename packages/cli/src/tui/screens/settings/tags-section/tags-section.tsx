import type { ReactNode } from "react";
import type { TagConfig } from "../../../../services/config/config.js";
import { listTags, removeTag } from "../../../../services/tag/tag.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { columnWidth } from "../column-width.js";
import { type CrudForm, CrudListSection, type CrudRow } from "../crud-list-section/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { TagFormModal } from "../tag-form-modal/index.js";
import { TagRow } from "../tag-row/index.js";

/** Removes the tag from the project and from each Story. */
function removeOne(tag: TagConfig, ctx: ServiceContext): Promise<unknown> {
  return removeTag({ value: tag.value }, ctx);
}

/** Gives the row renderer, with the label column of all tags. */
function tagRows(tags: readonly TagConfig[]): (tag: TagConfig, row: CrudRow) => ReactNode {
  const labelWidth = columnWidth(tags.map((t) => t.label));

  return (tag, row) => <TagRow tag={tag} labelWidth={labelWidth} {...row} />;
}

/**
 * The tags of the project. `n` or the **+ New Tag** Button adds a tag, `enter` or `e` edits the label
 * of the selected tag, as a click on its row does, and `d` removes it from the project and from each
 * Story after a confirmation.
 */
export function TagsSection({ ctx, onChange }: SettingsSectionProps) {
  return (
    <CrudListSection<TagConfig>
      ctx={ctx}
      onChange={onChange}
      noun="Tag"
      load={listTags}
      remove={removeOne}
      itemKey={(tag) => tag.value}
      itemLabel={(tag) => tag.label}
      confirmTitle={(tag) => tag.value}
      confirmMessage={(tag) => `Remove ${tag.label}? Rowbly also removes the tag from each Story.`}
      rows={tagRows}
      renderForm={(tag: TagConfig | undefined, form: CrudForm) => <TagFormModal ctx={ctx} tag={tag} {...form} />}
    />
  );
}
