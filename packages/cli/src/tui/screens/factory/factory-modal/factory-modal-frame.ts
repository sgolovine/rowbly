import { conversationKeys } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { ATTENTION_HINTS, factoryHints, problemHints } from "../factory-modal-text.js";
import type { FactoryModalModel } from "./use-factory-modal.js";

/** The frame of one view: its title, its keys and the action of the `✕` of the Modal. */
export interface ViewFrame {
  readonly title: string;
  readonly hints: readonly KeyHint[];
  readonly onClose: (() => void) | undefined;
}

const HISTORY_HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "enter", description: "open" },
  { key: "/", description: "filter" },
  { key: "esc", description: "back" },
];

/** The frame of the list of the warnings or of the detail view of one warning, or `undefined` for other views. */
function attentionFrame(model: FactoryModalModel): ViewFrame | undefined {
  const { attention } = model;

  if (model.view === "problem" && attention.problem) {
    return {
      title: `Factory › Attention › ${attention.problem.title}`,
      hints: problemHints(attention.can),
      onClose: attention.actions.closeDetail,
    };
  }

  if (model.view === "attention") {
    return { title: "Factory › Attention", hints: ATTENTION_HINTS, onClose: attention.actions.closeList };
  }

  return undefined;
}

/** The frame of the view on screen. The `✕` of the overview works only while no dialog is open. */
export function modalFrame(model: FactoryModalModel, onClose: () => void, aiSettings: boolean): ViewFrame {
  if (model.view === "thread") {
    return {
      title: `Factory › Old supervisor Threads › ${model.selected?.status ?? "unavailable"}`,
      hints: [...conversationKeys(false), { key: "esc", description: "back" }],
      onClose: model.actions.closeThread,
    };
  }

  if (model.view === "history") {
    return { title: "Factory › Old supervisor Threads", hints: HISTORY_HINTS, onClose: model.actions.closeHistory };
  }

  return (
    attentionFrame(model) ?? {
      title: "Factory",
      hints: factoryHints({ ...model.can, aiSettings }),
      onClose: model.idle ? onClose : undefined,
    }
  );
}
