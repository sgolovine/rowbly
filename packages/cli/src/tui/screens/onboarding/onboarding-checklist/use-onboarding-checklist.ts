import { type Key, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { SelectItem } from "../../../components/index.js";
import { useIsActive, useLayout, useReportHints } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";

/** The rows that the heading, the messages and the new-item input take from the list. */
const CHROME_ROWS = 6;

/** The way to add a row with `n`. */
export interface ChecklistAdd {
  readonly label: string;
  /** @returns The value of the new row, or an error message. */
  onAdd(text: string): { value: string } | { error: string };
}

/** The inputs of the checklist hook. */
interface ChecklistInput {
  readonly items: readonly SelectItem[];
  readonly selected: readonly string[];
  readonly emptyError: string | undefined;
  readonly add: ChecklistAdd | undefined;
  readonly onSubmit: (values: string[]) => void;
  readonly onBack: () => void;
  readonly onHints: (hints: readonly KeyHint[]) => void;
}

/** What the handlers of the checklist read and change. */
interface ChecklistEnv extends ChecklistInput {
  readonly checked: readonly string[];
  readonly adding: boolean;
  readonly text: string;
  readonly filtering: boolean;
  readonly setChecked: Dispatch<SetStateAction<readonly string[]>>;
  readonly setAdding: Dispatch<SetStateAction<boolean>>;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly setError: Dispatch<SetStateAction<string | undefined>>;
  readonly setCursor: Dispatch<SetStateAction<number>>;
}

/** The state of the checklist for one render. */
interface ChecklistModel {
  readonly active: boolean;
  readonly adding: boolean;
  readonly text: string;
  readonly error: string | undefined;
  readonly checked: readonly string[];
  readonly cursor: number;
  /** The rows of the list. All rows show when the height is not known. */
  readonly limit: number;
  readonly setText: Dispatch<SetStateAction<string>>;
  readonly setFiltering: Dispatch<SetStateAction<boolean>>;
  readonly change: (values: string[]) => void;
  readonly highlight: (item: SelectItem | undefined) => void;
  readonly submit: () => void;
}

function checklistHints(adding: boolean, add: ChecklistAdd | undefined): KeyHint[] {
  if (adding) {
    return [
      { key: "enter", description: "add" },
      { key: "esc", description: "cancel" },
    ];
  }

  return [
    { key: "↑/↓", description: "select" },
    { key: "space", description: "toggle" },
    ...(add ? [{ key: "n", description: add.label.toLowerCase() }] : []),
    { key: "enter", description: "next" },
    { key: "esc", description: "back" },
  ];
}

/** Adds the typed row and checks it. An error stays on screen, and the input stays open. */
function confirmAdd(env: ChecklistEnv): void {
  const result = env.add?.onAdd(env.text);

  if (!result) {
    return;
  }

  if ("error" in result) {
    env.setError(result.error);

    return;
  }

  env.setChecked((current) => (current.includes(result.value) ? current : [...current, result.value]));
  env.setCursor(Math.max(0, env.items.length));
  closeAdd(env);
}

function closeAdd(env: ChecklistEnv): void {
  env.setAdding(false);
  env.setText("");
  env.setError(undefined);
}

function handleAddKey(env: ChecklistEnv, key: Key): void {
  if (key.return) {
    confirmAdd(env);

    return;
  }

  if (key.escape) {
    closeAdd(env);
  }
}

function handleChecklistKey(env: ChecklistEnv, input: string, key: Key): void {
  if (env.adding) {
    handleAddKey(env, key);

    return;
  }

  if (key.escape && !env.filtering) {
    env.onBack();

    return;
  }

  if (input === "n" && env.add && !env.filtering) {
    env.setAdding(true);
  }
}

/** Goes on with the checked rows in the order of the rows, not in the order of the clicks. */
function submitChecklist(env: ChecklistEnv): void {
  const values = env.items.filter((item) => env.checked.includes(item.value)).map((item) => item.value);

  if (env.emptyError && values.length === 0) {
    env.setError(env.emptyError);

    return;
  }

  env.onSubmit(values);
}

function changeChecked(env: ChecklistEnv, values: string[]): void {
  env.setChecked(values);
  env.setError(undefined);
}

/** Keeps the cursor on the highlighted row, so that a new list after an add starts there. */
function highlightRow(env: ChecklistEnv, item: SelectItem | undefined): void {
  const at = item ? env.items.indexOf(item) : -1;

  if (at >= 0) {
    env.setCursor(at);
  }
}

function listLimit(height: number | undefined, rows: number): number {
  return height === undefined ? rows : Math.max(3, height - CHROME_ROWS);
}

/** The state, the keys and the handlers of one onboarding checklist. */
export function useOnboardingChecklist(input: ChecklistInput): ChecklistModel {
  const active = useIsActive();
  const layout = useLayout();
  const [checked, setChecked] = useState<readonly string[]>(input.selected);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const [cursor, setCursor] = useState(0);

  const env: ChecklistEnv = {
    ...input,
    checked,
    adding,
    text,
    filtering,
    setChecked,
    setAdding,
    setText,
    setError,
    setCursor,
  };

  useReportHints(input.onHints, checklistHints(adding, input.add));
  useInput((text, key) => handleChecklistKey(env, text, key), { isActive: active });

  return {
    active,
    adding,
    text,
    error,
    checked,
    cursor,
    limit: listLimit(layout.height, input.items.length),
    setText,
    setFiltering,
    change: (values) => changeChecked(env, values),
    highlight: (item) => highlightRow(env, item),
    submit: () => submitChecklist(env),
  };
}
