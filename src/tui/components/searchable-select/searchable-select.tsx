import { Text, useInput } from "ink";
import { type ReactNode, useContext, useEffect, useId, useRef, useState } from "react";
import { useKeyCapture, useMainOverlay } from "../../hooks/index.js";
import type { FormField } from "../form/index.js";
import { Modal } from "../modal/index.js";
import { LayerWrapContext } from "../modal-layer.js";
import { SearchableSelectPicker } from "../searchable-select-picker/index.js";

/** The query belongs to the picker; only choosing an option changes the Form's value. */
export function SearchableSelect({
  field,
  value,
  focused,
  onChange,
}: {
  field: FormField;
  value: string | null;
  focused: boolean;
  onChange(value: string): void;
}) {
  const overlay = useMainOverlay();
  const wrap = useContext(LayerWrapContext);
  const id = useId();
  const [picker, setPicker] = useState<ReactNode>(null);
  const report = useRef(onChange);
  report.current = onChange;
  // A picker opened from a short task needs the terminal's room, not that task's clipped body.
  useEffect(() => {
    if (!picker || !overlay) {
      return;
    }
    overlay.open(id, picker);
    return () => overlay.close(id);
  }, [picker, overlay, id]);
  const open = (query: string) =>
    setPicker(
      wrap(
        <Modal
          title={`Find ${field.label}`}
          onClose={() => setPicker(null)}
          hints={[
            { key: "enter", description: "choose" },
            { key: "↑/↓", description: "select" },
            { key: "ctrl+l", description: "clear query" },
            { key: "esc", description: "cancel" },
          ]}
        >
          <SearchableSelectPicker
            options={field.options ?? []}
            labels={field.optionLabels}
            searchText={field.optionSearchText}
            initialQuery={query}
            value={value}
            onSelect={(option) => {
              report.current(option);
              setPicker(null);
            }}
            onCancel={() => setPicker(null)}
          />
        </Modal>,
      ),
    );
  useKeyCapture(focused && !picker);
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) {
        return;
      }
      if (key.return) {
        open("");
      } else if (
        input &&
        !key.escape &&
        !key.tab &&
        !key.upArrow &&
        !key.downArrow &&
        !key.leftArrow &&
        !key.rightArrow &&
        !key.backspace &&
        !key.delete
      ) {
        open(input);
      }
    },
    { isActive: focused && !picker },
  );
  return (
    <>
      <Text wrap="truncate-end">{!value ? "—" : (field.optionLabels?.[value] ?? value)}</Text>
      {!overlay && picker}
    </>
  );
}
