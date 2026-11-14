import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";
import type { ModelChoice } from "../../../../services/factory-settings/factory-settings.js";
import { Modal, SearchableSelectPicker } from "../../../components/index.js";
import {
  runExclusive,
  type ToastStore,
  useEscape,
  useIsActive,
  useKeyCapture,
  useToast,
} from "../../../hooks/index.js";
import { ThinkingPicker } from "../thinking-picker/index.js";
import {
  DEFAULT,
  levelChoice,
  modelLabels,
  PI_DEFAULT_LABEL,
  type PickerModel,
  pickerHints,
  pickerId,
} from "./model-picker-text.js";

export type { PickerModel } from "./model-picker-text.js";
export { NO_OVERRIDE_LABEL } from "./model-picker-text.js";

/** What a save of the picker reads and changes. */
interface PickerEnv {
  readonly models: readonly PickerModel[];
  readonly toast: ToastStore;
  /** True while a save runs, so that a second `enter` does not save again. */
  readonly saving: RefObject<boolean>;
  readonly setModel: Dispatch<SetStateAction<PickerModel | undefined>>;
  readonly onSave: (choice: ModelChoice | null) => Promise<void>;
}

/** Saves the choice. An error shows as a toast, and the Modal stays open. */
function saveChoice(env: PickerEnv, choice: ModelChoice | null): void {
  runExclusive(env.saving, () => env.onSave(choice)).catch((error: unknown) => env.toast.error(error));
}

/** The Pi default and a model with one level or none have no level to choose, so they save at once. */
function pickModel(env: PickerEnv, id: string): void {
  const found = env.models.find((m) => pickerId(m) === id);

  if (!found) {
    saveChoice(env, null);

    return;
  }

  if (found.thinkingLevels.length <= 1) {
    saveChoice(env, { provider: found.provider, modelId: found.modelId });

    return;
  }

  env.setModel(found);
}

/**
 * Selects the model of one factory role in two steps, in a generic Modal: a model from a search of the
 * available models (or the first option, `Pi default` or `No override`), then one of the thinking levels that the model supports. `esc` goes
 * back one step, then closes. `onSave` gets `null` for the first option.
 */
export function ModelPickerModal({
  title,
  models,
  current,
  defaultLabel = PI_DEFAULT_LABEL,
  onSave,
  onClose,
}: {
  title: string;
  models: readonly PickerModel[];
  current?: ModelChoice;
  /** The label of the first option, which saves `null`. An override picker uses `No override`. */
  defaultLabel?: string;
  /** May throw: the error shows as a toast, and the Modal stays open. */
  onSave(choice: ModelChoice | null): Promise<void>;
  onClose(): void;
}) {
  const active = useIsActive();
  const toast = useToast();
  const [model, setModel] = useState<PickerModel | undefined>(undefined);
  const saving = useRef(false);

  const env: PickerEnv = { models, toast, saving, setModel, onSave };

  useKeyCapture(active && model !== undefined, { text: false, escape: true });
  useEscape(active && model !== undefined, () => setModel(undefined));

  return (
    <Modal title={model ? `${title} › Thinking` : title} onClose={onClose} hints={pickerHints(model !== undefined)}>
      {model ? (
        <ThinkingPicker
          modelId={pickerId(model)}
          levels={model.thinkingLevels}
          current={current?.thinkingLevel}
          active={active}
          onSelect={(level) => saveChoice(env, levelChoice(model, level))}
        />
      ) : (
        <SearchableSelectPicker
          options={[DEFAULT, ...models.map(pickerId)]}
          labels={modelLabels(models, defaultLabel)}
          initialQuery=""
          value={current ? pickerId(current) : DEFAULT}
          onSelect={(id) => pickModel(env, id)}
          onCancel={onClose}
        />
      )}
    </Modal>
  );
}
