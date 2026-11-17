import { type ProjectConfig, projectTags } from "../config/config.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { Store } from "../store/store.js";
import { tagsOf, withTags } from "../story-files/story-files.js";
import { type DocRepair, type DoctorIssue, type DoctorRun, reportChange } from "./doctor-run.js";

/** The frontmatter without the tag value. */
function withoutTagValue(data: DocRepair["data"], value: string): Record<string, unknown> {
  const tags = tagsOf({ ...data });

  return withTags(
    { ...data },
    tags.filter((tag) => tag !== value),
  );
}

/** Tells if the `tags` value is a list of strings. */
function isTagList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** A `tags` value that is not a list of strings keeps only its string items. */
async function tagListIssues(run: DoctorRun, repair: Store<DocRepair>, file: string): Promise<DoctorIssue[]> {
  if (isTagList(repair.current.data.tags)) {
    return [];
  }

  return [
    await reportChange(
      run,
      repair,
      { severity: "error", message: "tags must be a list of tag values", file, fix: "Keep only the tag values" },
      (state) => ({ data: withTags({ ...state.data }, tagsOf({ ...state.data })) }),
    ),
  ];
}

function unknownTagIssue(run: DoctorRun, repair: Store<DocRepair>, value: string, file: string): Promise<DoctorIssue> {
  return reportChange(
    run,
    repair,
    { severity: "error", message: `"${value}" is not a tag of this project`, file, fix: "Remove it" },
    (state) => ({ data: withoutTagValue(state.data, value) }),
  );
}

/** Each value in the `tags` list of a Story must be a tag of the project. */
export async function tagIssues(
  run: DoctorRun,
  config: ProjectConfig,
  repair: Store<DocRepair>,
  file: string,
): Promise<DoctorIssue[]> {
  if (!("tags" in repair.current.data)) {
    return [];
  }

  const list = await tagListIssues(run, repair, file);
  const known = new Set(projectTags(config).map((tag) => tag.value));
  const unknown = [...new Set(tagsOf({ ...repair.current.data }).filter((value) => !known.has(value)))];

  const issues = await mapInOrder(unknown, (value) => unknownTagIssue(run, repair, value, file));

  return [...list, ...issues];
}
