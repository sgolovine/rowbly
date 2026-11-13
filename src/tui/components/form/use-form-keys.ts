import { useContext, useEffect, useId } from "react";
import { ScreenDepthContext, ShellContext } from "../../hooks/index.js";
import { FORM_KEYS, formKeys, type KeyHint } from "../../keymap.js";
import { FormKeysContext } from "../modal-layer.js";

/** What changes the key hints of a `Form`. */
export interface FormHintOptions {
  /** A create host with tabs moves between its tabs with `shift+tab`. */
  readonly navigation: boolean;
  readonly submitLabel: string;
  /** The focused field opens a fuzzy picker with `enter`. */
  readonly searchable: boolean;
  readonly submitOnEnter: boolean;
}

/** The key hints of a `Form`. */
export function formHints({ navigation, submitLabel, searchable, submitOnEnter }: FormHintOptions): readonly KeyHint[] {
  if (navigation) {
    return [
      { key: "ctrl+s", description: submitLabel },
      { key: "shift+tab", description: "next tab" },
      ...(searchable ? [{ key: "enter", description: "search" }] : []),
      { key: searchable ? "tab/↑/↓" : "tab/↑/↓/enter", description: "field" },
    ];
  }

  if (searchable) {
    return [
      { key: "ctrl+s", description: submitLabel },
      { key: "enter", description: "search" },
      { key: "tab/↑/↓", description: "field" },
      { key: "shift+tab", description: "previous field" },
    ];
  }

  return submitLabel === "save" && !submitOnEnter ? FORM_KEYS : formKeys(submitLabel, submitOnEnter);
}

/** The key hints with the screen-specific `extra` hints after the submit key, before the navigation keys. */
export function withExtraHints(keys: readonly KeyHint[], extra: readonly KeyHint[]): readonly KeyHint[] {
  return [...keys.slice(0, 1), ...extra, ...keys.slice(1)];
}

/**
 * Shows the Form keys while `active`: in the strip of the Modal around the form, or else with the
 * screen's own hints, so every form says `ctrl+s save` without its screen adding it.
 */
export function useFormKeys(active: boolean, keys: readonly KeyHint[]): void {
  const modal = useContext(FormKeysContext);
  const shell = useContext(ShellContext);
  const depth = useContext(ScreenDepthContext);
  const id = useId();

  useEffect(() => {
    if (!active) {
      return;
    }

    if (modal) {
      return modal(keys);
    }

    if (depth < 0) {
      return;
    }

    shell.setHints(depth, id, keys, true);

    return () => shell.setHints(depth, id, null);
  }, [active, modal, shell, depth, id, keys]);
}
