import { Box, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  Button,
  ConfirmDialog,
  Form,
  type FormField,
  type FormModalDelete,
  FormNavigationContext,
  type FormValues,
  Modal,
  ScrollBody,
  Tabs,
  useCovered,
} from "../../../components/index.js";
import { LayoutContext, useEscape, useIsActive, useKeyCapture, useLayout } from "../../../hooks/index.js";
import { isSubmitKey, type KeyHint } from "../../../keymap.js";
import { SpecsTab } from "../SpecsTab/index.js";

/** Which confirmation is on top of the Modal. */
export type StoryModalConfirm = "discard" | "delete" | null;

/** The Modal is flush, so that the Panels of the Specs tab reach its frame. The other parts pad themselves. */
const PADDING_X = 2;
/** The blank row above the Tabs and the row of the Tabs. */
const TABS_HEIGHT = 2;
/** The blank row under the Tabs and the blank row at the bottom of the General tab. */
const GENERAL_PADDING_Y = 2;
const NO_HINTS: readonly KeyHint[] = [];
/** The Form leaves `shift+tab` and the save key to this body, which changes the tab and asks the Form to save. */
const NAVIGATION = { extraHints: NO_HINTS, register: () => () => {} };
const GENERAL = 0;
const SPECS = 1;

/**
 * The inside of the `StoryModal`. `shift+tab` or a click changes the tab. Both tabs stay mounted, so that a
 * change of tab keeps the text that is not saved. The Delete Button and `ctrl+d` of the General tab ask
 * before they delete the Story.
 */
export function StoryModalBody({
  ctx,
  storyId,
  fields,
  initialValues,
  onSubmit,
  onClose,
  onRequestClose,
  onDelete,
  confirming,
  onConfirming,
  onHints,
}: {
  ctx: ServiceContext;
  storyId: string;
  fields: readonly FormField[];
  initialValues: FormValues;
  onSubmit(values: FormValues): void | Promise<void>;
  /** Closes the Modal now. */
  onClose(): void;
  /** Closes the Modal, or asks first if there are unsaved changes. */
  onRequestClose(): void;
  onDelete: FormModalDelete;
  confirming: StoryModalConfirm;
  onConfirming(confirm: StoryModalConfirm): void;
  /** The keys of the tab on the screen, for the hint strip of the Modal. */
  onHints(hints: readonly KeyHint[]): void;
}) {
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const [tab, setTab] = useState(GENERAL);
  const [specCount, setSpecCount] = useState<number | undefined>(undefined);
  const [specEditing, setSpecEditing] = useState(false);
  const [specHints, setSpecHints] = useState<readonly KeyHint[]>(NO_HINTS);
  const [submitRequest, setSubmitRequest] = useState(0);
  const idle = active && !covered && confirming === null;
  const general = tab === GENERAL;

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle && !specEditing, onRequestClose);
  useInput(
    (input, key) => {
      if (key.tab && key.shift) setTab(general ? SPECS : GENERAL);
      else if (general && isSubmitKey(input, key)) setSubmitRequest((n) => n + 1);
      else if (general && key.ctrl && input === "d") onConfirming("delete");
    },
    { isActive: idle },
  );

  const hints: readonly KeyHint[] = general
    ? [{ key: "ctrl+d", description: "delete" }]
    : [
        ...specHints,
        { key: "shift+tab", description: "next tab", secondary: true },
        ...(specEditing ? [] : [{ key: "esc", description: "close" }]),
      ];
  const hintsKey = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hintsKey` stands in for `hints`, which is new on each render.
  useEffect(() => onHints(hints), [hintsKey, onHints]);

  const generalLayout = useMemo(
    () => ({
      width: Math.max(1, layout.width - 2 * PADDING_X),
      height: layout.height === undefined ? undefined : Math.max(1, layout.height - TABS_HEIGHT - GENERAL_PADDING_Y),
    }),
    [layout.width, layout.height],
  );
  const specsLayout = useMemo(
    () => ({
      width: layout.width,
      height: layout.height === undefined ? undefined : Math.max(1, layout.height - TABS_HEIGHT),
    }),
    [layout.width, layout.height],
  );
  return (
    <Box flexDirection="column" height={layout.height}>
      <Box paddingX={PADDING_X} paddingTop={1} flexShrink={0}>
        <Tabs
          tabs={["General", specCount === undefined ? "Specs" : `Specs ${specCount}`]}
          selected={tab}
          onSelect={setTab}
          active={idle}
        />
      </Box>
      <LayoutContext.Provider value={generalLayout}>
        <Box display={general ? "flex" : "none"} flexDirection="column" paddingX={PADDING_X} paddingY={1}>
          <ScrollBody active={idle && general} height={generalLayout.height}>
            <FormNavigationContext.Provider value={NAVIGATION}>
              <Form
                fields={fields}
                initialValues={initialValues}
                onSubmit={onSubmit}
                isActive={general && confirming === null}
                submitRequest={submitRequest}
              />
            </FormNavigationContext.Provider>
            <Box marginTop={1}>
              <Button
                label="Delete"
                keyName="ctrl+d"
                onClick={() => onConfirming("delete")}
                clickable={idle && general}
                compact
                destructive
              />
            </Box>
          </ScrollBody>
        </Box>
      </LayoutContext.Provider>
      <LayoutContext.Provider value={specsLayout}>
        <Box display={general ? "none" : "flex"} flexDirection="column">
          <SpecsTab
            ctx={ctx}
            storyId={storyId}
            selected={!general && confirming === null}
            onCount={setSpecCount}
            onEditing={setSpecEditing}
            onHints={setSpecHints}
          />
        </Box>
      </LayoutContext.Provider>
      {confirming === "discard" && (
        <Modal title="Discard changes" size="dialog">
          <ConfirmDialog
            message="Close and discard unsaved changes?"
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            destructive
            onConfirm={onClose}
            onCancel={() => onConfirming(null)}
          />
        </Modal>
      )}
      {confirming === "delete" && (
        <Modal title={onDelete.title} size="dialog">
          <ConfirmDialog
            message={onDelete.message}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            destructive
            onConfirm={() => {
              onConfirming(null);
              onDelete.onConfirm();
            }}
            onCancel={() => onConfirming(null)}
          />
        </Modal>
      )}
    </Box>
  );
}
