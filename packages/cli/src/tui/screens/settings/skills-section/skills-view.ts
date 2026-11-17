import type { Dispatch, SetStateAction } from "react";
import { bundledSkills, listSkills, type SkillStatus } from "../../../../services/skill/skill.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { AsyncState } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import type { SkillMode } from "../skill-action-modal/index.js";

/** The bundled skills by name, and the skills that the Project tracks. */
export interface SkillLists {
  readonly bundled: readonly string[];
  readonly tracked: readonly SkillStatus[];
}

/** What the keys of the Skills section read and change. */
export interface SkillsEnv {
  readonly list: AsyncState<SkillLists>;
  readonly canInstall: boolean;
  readonly canRemove: boolean;
  readonly setMode: Dispatch<SetStateAction<SkillMode | null>>;
  readonly onChange: () => void;
}

/** Reads the bundled and the tracked skills. */
export async function loadSkills(ctx: ServiceContext): Promise<SkillLists> {
  const [bundled, tracked] = await Promise.all([bundledSkills(ctx), listSkills(ctx)]);

  return { bundled: bundled.names, tracked };
}

/** All skill names, bundled or tracked, in order and without repeats. */
export function skillNames(lists: SkillLists | undefined): string[] {
  return [...new Set([...(lists?.bundled ?? []), ...(lists?.tracked.map((s) => s.name) ?? [])])].toSorted();
}

/** The keys of the Skills section that work now. */
export function skillsHints(idle: boolean, canInstall: boolean, canRemove: boolean): KeyHint[] {
  if (!idle) {
    return [];
  }

  return [
    { key: "↑/↓", description: "select" },
    { key: "/", description: "filter" },
    ...(canInstall ? [{ key: "i", description: "install" }] : []),
    ...(canRemove ? [{ key: "d", description: "uninstall" }] : []),
    { key: "r", description: "reload" },
  ];
}

/** `i` installs, `d` uninstalls and `r` reads the skills again. */
export function skillsKey(env: SkillsEnv, input: string): void {
  if (input === "i" && env.canInstall) {
    env.setMode("install");

    return;
  }

  if (input === "d" && env.canRemove) {
    env.setMode("remove");

    return;
  }

  if (input === "r") {
    env.list.reload();
  }
}

/** Closes the Modal and reads the skills again, also behind Settings. */
export function skillSaved(env: SkillsEnv): void {
  env.setMode(null);
  env.list.reload();
  env.onChange();
}
