import type { Stage } from "../../../services/stage/stage.js";
import type { StageCategory } from "../../components/index.js";

/**
 * The colour family of the Stage `key`: the first Stage of the board is `backlog`, the last is `done`,
 * and all Stages between them are `board`. An unknown Stage is `backlog`.
 */
export function stageCategory(stages: readonly Stage[], key: string): StageCategory {
  const at = stages.findIndex((stage) => stage.key === key);
  if (at <= 0 || stages.length < 2) return "backlog";
  return at === stages.length - 1 ? "done" : "board";
}
