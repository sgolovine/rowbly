import type { ModelChoice } from "../../../../services/factory-settings/factory-settings.js";
import type { KeyHint } from "../../../keymap.js";

/** A model that a signed-in provider offers, with the thinking levels that it supports. */
export interface PickerModel {
  provider: string;
  modelId: string;
  name: string;
  thinkingLevels: readonly string[];
}

/** The option that clears the choice, so that Pi selects its default model. */
export const DEFAULT = "";

/** The id of a model in the search: `provider/modelId`. */
export function pickerId(model: { readonly provider: string; readonly modelId: string }): string {
  return `${model.provider}/${model.modelId}`;
}

/** The label of each option. A model with a name of its own shows the name after its id. */
export function modelLabels(models: readonly PickerModel[]): Record<string, string> {
  return Object.fromEntries([
    [DEFAULT, "Pi default"],
    ...models.map((m) => [pickerId(m), m.name && m.name !== m.modelId ? `${pickerId(m)} · ${m.name}` : pickerId(m)]),
  ]);
}

/** The keys of the model search, or of the thinking levels after a model is chosen. */
export function pickerHints(thinking: boolean): KeyHint[] {
  if (thinking) {
    return [
      { key: "enter", description: "save" },
      { key: "↑/↓", description: "select" },
      { key: "esc", description: "back" },
    ];
  }

  return [
    { key: "enter", description: "choose" },
    { key: "↑/↓", description: "select" },
    { key: "ctrl+l", description: "clear query" },
    { key: "esc", description: "cancel" },
  ];
}

/** The choice of a model with a thinking level. The empty level is the default of the model. */
export function levelChoice(model: PickerModel, level: string): ModelChoice {
  return {
    provider: model.provider,
    modelId: model.modelId,
    ...(level ? { thinkingLevel: level as ModelChoice["thinkingLevel"] } : {}),
  };
}
