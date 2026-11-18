import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, Fragment, type ReactNode, type SetStateAction, useState } from "react";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, ConfirmDialog, Loading } from "../../../components/index.js";
import {
  type AsyncState,
  showToast,
  type ToastStore,
  useAsync,
  useCursor,
  useIsActive,
  useKeyHints,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import type { SettingsSectionProps } from "../settings-sections.js";

/** The state of one row that the list gives to `renderRow`. */
export interface CrudRow {
  readonly selected: boolean;
  /** False while a Form or a dialog has the keys; then the row does not take a click. */
  readonly active: boolean;
  readonly onClick: () => void;
}

/** The callbacks that the list gives to the Form of a new or an edited item. */
export interface CrudForm {
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** The props of `CrudListSection`. */
export interface CrudListSectionProps<T> extends SettingsSectionProps {
  /** The name of one item, for example `Tag`. The loading label, the empty text, the Button and the hints use it. */
  readonly noun: string;
  readonly load: (ctx: ServiceContext) => Promise<T[]>;
  readonly remove: (item: T, ctx: ServiceContext) => Promise<unknown>;
  readonly itemKey: (item: T) => string;
  /** The name of the item in the `Removed <label>` toast. */
  readonly itemLabel: (item: T) => string;
  /** The text after `Remove <noun> › ` in the title of the confirm dialog. */
  readonly confirmTitle: (item: T) => string;
  readonly confirmMessage: (item: T) => string;
  /** Gets all items once, so that the caller can compute its column widths, and gives the row renderer. */
  readonly rows: (items: readonly T[]) => (item: T, row: CrudRow) => ReactNode;
  /** The Form Modal for a new item (`undefined`) or for the edited item. */
  readonly renderForm: (item: T | undefined, form: CrudForm) => ReactNode;
}

type Mode<T> =
  | { readonly kind: "list" }
  | { readonly kind: "new" }
  | { readonly kind: "edit"; readonly item: T }
  | { readonly kind: "remove"; readonly item: T };

/** What the handlers of the section read and change. */
interface CrudEnv<T> {
  readonly props: CrudListSectionProps<T>;
  readonly toast: ToastStore;
  readonly list: AsyncState<T[]>;
  readonly current: T | undefined;
  readonly setMode: Dispatch<SetStateAction<Mode<T>>>;
  readonly setCursor: (index: number) => void;
}

function crudHints<T>(noun: string, idle: boolean, current: T | undefined): KeyHint[] {
  if (!idle) {
    return [];
  }

  return [
    { key: "↑/↓", description: "select" },
    { key: "n", description: `new ${noun}` },
    ...(current
      ? [
          { key: "enter", description: "edit" },
          { key: "d", description: "remove" },
        ]
      : []),
  ];
}

/** Goes back to the list and reads the items again, also in the screens behind Settings. */
function done<T>(env: CrudEnv<T>): void {
  env.setMode({ kind: "list" });
  env.list.reload();
  env.props.onChange();
}

function crudKey<T>(env: CrudEnv<T>, input: string, key: Key): void {
  if (input === "n") {
    env.setMode({ kind: "new" });

    return;
  }

  if (env.current && (key.return || input === "e")) {
    env.setMode({ kind: "edit", item: env.current });

    return;
  }

  if (env.current && input === "d") {
    env.setMode({ kind: "remove", item: env.current });
  }
}

function openItem<T>(env: CrudEnv<T>, index: number, item: T): void {
  env.setCursor(index);
  env.setMode({ kind: "edit", item });
}

/** Removes the item. A failure goes back to the list. */
function removeOne<T>(env: CrudEnv<T>, item: T): void {
  env.props.remove(item, env.props.ctx).then(
    () => removed(env, item),
    (err: unknown) => removeFailed(env, err),
  );
}

function removed<T>(env: CrudEnv<T>, item: T): void {
  showToast(env.toast, "info", `Removed ${env.props.itemLabel(item)}`);
  done(env);
}

function removeFailed<T>(env: CrudEnv<T>, err: unknown): void {
  env.toast.error(err);
  env.setMode({ kind: "list" });
}

/**
 * A Settings section with a list of items. `n` or the **+ New** Button adds an item, `enter` or `e`
 * edits the selected item, as a click on its row does, and `d` removes it after a destructive confirmation.
 */
export function CrudListSection<T>(props: CrudListSectionProps<T>) {
  const { ctx, noun } = props;
  const active = useIsActive();
  const toast = useToast();
  const [mode, setMode] = useState<Mode<T>>({ kind: "list" });
  // Only `ctx` reloads the list, because the caller can give a new `load` function on each render.
  const list = useAsync(() => props.load(ctx), [ctx]);
  const items = list.data ?? [];
  const idle = active && mode.kind === "list";
  const [cursor, setCursor] = useCursor(items.length, idle);

  const current = items[cursor];
  const env: CrudEnv<T> = { props, toast, list, current, setMode, setCursor };

  useKeyHints(crudHints(noun, idle, current));
  useInput((input, key) => crudKey(env, input, key), { isActive: idle });

  if (!list.data) {
    return list.loading ? <Loading label={`Loading ${noun}s…`} /> : null;
  }

  const renderRow = props.rows(items);

  return (
    <Box flexDirection="column">
      {items.length === 0 && <Text color={theme.inkFaint}>{`No ${noun}s. Press n to add one.`}</Text>}
      {items.map((item, i) => (
        <Fragment key={props.itemKey(item)}>
          {renderRow(item, { selected: i === cursor, active: idle, onClick: () => openItem(env, i, item) })}
        </Fragment>
      ))}
      <Box marginTop={1}>
        <Button label={`+ New ${noun}`} keyName="n" onClick={() => setMode({ kind: "new" })} clickable={idle} compact />
      </Box>
      {(mode.kind === "new" || mode.kind === "edit") &&
        props.renderForm(mode.kind === "edit" ? mode.item : undefined, {
          onClose: () => setMode({ kind: "list" }),
          onSaved: () => done(env),
        })}
      {mode.kind === "remove" && (
        <ConfirmDialog
          title={`Remove ${noun} › ${props.confirmTitle(mode.item)}`}
          message={props.confirmMessage(mode.item)}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => removeOne(env, mode.item)}
          onCancel={() => setMode({ kind: "list" })}
        />
      )}
    </Box>
  );
}
