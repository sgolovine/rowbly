import { Box, Text } from "ink";
import { useRef, useState } from "react";
import type { ModelChoice } from "../../../../services/factory-settings/factory-settings.js";
import { Modal, SearchableSelectPicker, SelectList } from "../../../components/index.js";
import { ActiveContext, useEscape, useIsActive, useKeyCapture, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";

/** A model that a signed-in provider offers, with the thinking levels that it supports. */
export interface PickerModel {
  provider: string;
  modelId: string;
  name: string;
  thinkingLevels: readonly string[];
}

/** The option that clears the choice, so that Pi selects its default model. */
const DEFAULT = "";

/**
 * Selects the model of one factory role in two steps, in a generic Modal: a model from a search of the
 * available models (or the Pi default), then one of the thinking levels that the model supports. `esc` goes
 * back one step, then closes. `onSave` gets `null` for the Pi default.
 */
export function ModelPickerModal({
  title,
  models,
  current,
  onSave,
  onClose,
}: {
  title: string;
  models: readonly PickerModel[];
  current?: ModelChoice;
  /** May throw: the error shows as a toast, and the Modal stays open. */
  onSave(choice: ModelChoice | null): Promise<void>;
  onClose(): void;
}) {
  const active = useIsActive();
  const toast = useToast();
  const [model, setModel] = useState<PickerModel | undefined>(undefined);
  const saving = useRef(false);
  const ids = models.map((m) => `${m.provider}/${m.modelId}`);
  const labels = Object.fromEntries([
    [DEFAULT, "Pi default"],
    ...models.map((m) => [
      `${m.provider}/${m.modelId}`,
      m.name && m.name !== m.modelId ? `${m.provider}/${m.modelId} · ${m.name}` : `${m.provider}/${m.modelId}`,
    ]),
  ]);
  const save = (choice: ModelChoice | null) => {
    if (saving.current) return;
    saving.current = true;
    onSave(choice).then(
      () => {
        saving.current = false;
      },
      (error: unknown) => {
        saving.current = false;
        toast.error(error);
      },
    );
  };
  const pick = (id: string) => {
    const found = models.find((m) => `${m.provider}/${m.modelId}` === id);
    if (!found) return save(null);
    // A model with one level or none has no choice to make.
    if (found.thinkingLevels.length <= 1) return save({ provider: found.provider, modelId: found.modelId });
    setModel(found);
  };
  useKeyCapture(active && model !== undefined, { text: false, escape: true });
  useEscape(active && model !== undefined, () => setModel(undefined));
  const currentId = current ? `${current.provider}/${current.modelId}` : DEFAULT;
  return (
    <Modal
      title={model ? `${title} › Thinking` : title}
      onClose={onClose}
      hints={
        model
          ? [
              { key: "enter", description: "save" },
              { key: "↑/↓", description: "select" },
              { key: "esc", description: "back" },
            ]
          : [
              { key: "enter", description: "choose" },
              { key: "↑/↓", description: "select" },
              { key: "ctrl+l", description: "clear query" },
              { key: "esc", description: "cancel" },
            ]
      }
    >
      {model ? (
        <Box flexDirection="column" gap={1}>
          <Text color={theme.inkMuted} wrap="truncate-end">
            The thinking levels of {model.provider}/{model.modelId}
          </Text>
          <ActiveContext.Provider value={active}>
            <SelectList
              items={[
                { value: DEFAULT, label: "Model default" },
                ...model.thinkingLevels.map((level) => ({ value: level, label: level })),
              ]}
              defaultIndex={Math.max(0, model.thinkingLevels.indexOf(current?.thinkingLevel ?? "") + 1)}
              onSelect={(item) =>
                save({
                  provider: model.provider,
                  modelId: model.modelId,
                  ...(item.value ? { thinkingLevel: item.value as ModelChoice["thinkingLevel"] } : {}),
                })
              }
            />
          </ActiveContext.Provider>
        </Box>
      ) : (
        <SearchableSelectPicker
          options={[DEFAULT, ...ids]}
          labels={labels}
          initialQuery=""
          value={currentId}
          onSelect={pick}
          onCancel={onClose}
        />
      )}
    </Modal>
  );
}
