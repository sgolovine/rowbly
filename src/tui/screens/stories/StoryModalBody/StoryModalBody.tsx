import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  Button,
  ConfirmDialog,
  Form,
  type FormField,
  type FormModalDelete,
  FormNavigationContext,
  type FormValues,
  ScrollBody,
  Tabs,
  useCovered,
} from "../../../components/index.js";
import {
  IMAGE_PASTE_HINT,
  LayoutContext,
  useEscape,
  useIsActive,
  useKeyCapture,
  useLayout,
  useStoryPaste,
} from "../../../hooks/index.js";
import { isSubmitKey, type KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { AttachmentsTab } from "../AttachmentsTab/index.js";
import { SpecsTab } from "../SpecsTab/index.js";
import { ThreadsTab } from "../ThreadsTab/index.js";

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

/** The tabs of the Modal. The position of a tab depends on the tabs before it, so the body uses these ids. */
type TabId = "general" | "specs" | "attachments" | "threads";

/**
 * The inside of the `StoryModal`. `shift+tab` or a click changes the tab. The tabs stay mounted, so that a
 * change of tab keeps the text that is not saved. The Threads tab reads its data only after it is selected.
 * The Delete Button and `ctrl+d` of the General tab ask before they delete the Story.
 */
export function StoryModalBody({
  ctx,
  storyId,
  stages,
  specs = true,
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
  /** The names of the Stages by key, for the Threads tab. */
  stages?: Readonly<Record<string, string>>;
  specs?: boolean;
  fields: readonly FormField[];
  initialValues: FormValues;
  onSubmit(values: FormValues, attachments?: readonly PendingImage[]): void | Promise<void>;
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
  const tabIds: readonly TabId[] = specs
    ? ["general", "specs", "attachments", "threads"]
    : ["general", "attachments", "threads"];
  const [tabId, setTabId] = useState<TabId>("general");
  const tab = Math.max(0, tabIds.indexOf(tabId));
  const [specCount, setSpecCount] = useState<number | undefined>(undefined);
  const [threadCount, setThreadCount] = useState<number | undefined>(undefined);
  const [threadViewing, setThreadViewing] = useState(false);
  const [threadHints, setThreadHints] = useState<readonly KeyHint[]>(NO_HINTS);
  const [specEditing, setSpecEditing] = useState(false);
  const [specHints, setSpecHints] = useState<readonly KeyHint[]>(NO_HINTS);
  const [submitRequest, setSubmitRequest] = useState(0);
  const idle = active && !covered && confirming === null;
  const general = tabIds[tab] === "general";
  const specsTab = tabIds[tab] === "specs";
  const attachmentTab = tabIds[tab] === "attachments";
  const threadsTab = tabIds[tab] === "threads";
  // A sub-region of a tab that takes `esc` and `tab` for itself.
  const tabOwnsKeys = specEditing || threadViewing;
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const paste = useStoryPaste(`${ctx.cwd ?? ""}:${storyId}`, storyId, idle && !saving);
  const [attachmentHints, setAttachmentHints] = useState<readonly KeyHint[]>(NO_HINTS);
  const [attachmentTask, setAttachmentTask] = useState(false);

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle && !tabOwnsKeys && !attachmentTask, onRequestClose);
  useInput(
    (input, key) => {
      if (key.tab && key.shift) setTabId(tabIds[(tab + 1) % tabIds.length] ?? "general");
      else if (!specEditing && !attachmentTask && isSubmitKey(input, key)) setSubmitRequest((n) => n + 1);
      else if (general && key.ctrl && input === "d") onConfirming("delete");
    },
    { isActive: idle },
  );

  const hints: readonly KeyHint[] = general
    ? [{ key: "ctrl+d", description: "delete" }]
    : [
        ...(attachmentTab ? attachmentHints : threadsTab ? threadHints : specHints),
        { key: "ctrl+s", description: "save" },
        IMAGE_PASTE_HINT,
        { key: "shift+tab", description: "next tab", secondary: true },
        ...(tabOwnsKeys ? [] : [{ key: "esc", description: "close" }]),
      ];
  const hintsKey = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hintsKey` stands in for `hints`, which is new on each render.
  useEffect(() => onHints(hints), [hintsKey, onHints]);

  const summaryRows = paste.summary ? 1 : 0;
  const generalLayout = useMemo(
    () => ({
      width: Math.max(1, layout.width - 2 * PADDING_X),
      height:
        layout.height === undefined
          ? undefined
          : Math.max(1, layout.height - TABS_HEIGHT - GENERAL_PADDING_Y - summaryRows),
    }),
    [layout.width, layout.height, summaryRows],
  );
  const specsLayout = useMemo(
    () => ({
      width: layout.width,
      height: layout.height === undefined ? undefined : Math.max(1, layout.height - TABS_HEIGHT - summaryRows),
    }),
    [layout.width, layout.height, summaryRows],
  );
  return (
    <Box flexDirection="column" height={layout.height}>
      <Box paddingX={PADDING_X} paddingTop={1} flexShrink={0}>
        <Tabs
          tabs={[
            "General",
            ...(specs ? [specCount === undefined ? "Specs" : `Specs ${specCount}`] : []),
            "Attachments",
            threadCount === undefined ? "Threads" : `Threads ${threadCount}`,
          ]}
          selected={tab}
          onSelect={(index) => setTabId(tabIds[index] ?? "general")}
          active={idle}
        />
      </Box>
      {paste.summary && (
        <Box paddingX={PADDING_X}>
          <Text color={theme.inkMuted}>{paste.summary}</Text>
        </Box>
      )}
      <LayoutContext.Provider value={generalLayout}>
        <Box display={general ? "flex" : "none"} flexDirection="column" paddingX={PADDING_X} paddingY={1}>
          <ScrollBody active={idle && general} height={generalLayout.height}>
            <FormNavigationContext.Provider value={NAVIGATION}>
              <Form
                fields={fields}
                initialValues={initialValues}
                onSubmit={async (values) => {
                  if (paste.busy || savingNow.current) return;
                  savingNow.current = true;
                  setSaving(true);
                  try {
                    await onSubmit(values, paste.pending);
                    paste.saved();
                  } finally {
                    savingNow.current = false;
                    setSaving(false);
                  }
                }}
                extraHints={[IMAGE_PASTE_HINT]}
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
        <Box display={specsTab ? "flex" : "none"} flexDirection="column">
          {specs && (
            <SpecsTab
              ctx={ctx}
              storyId={storyId}
              selected={specsTab && confirming === null}
              onCount={setSpecCount}
              onEditing={setSpecEditing}
              onHints={setSpecHints}
            />
          )}
        </Box>
        <Box display={threadsTab ? "flex" : "none"} flexDirection="column">
          <ThreadsTab
            ctx={ctx}
            storyId={storyId}
            stages={stages}
            selected={threadsTab && confirming === null}
            onCount={setThreadCount}
            onEditing={setThreadViewing}
            onHints={setThreadHints}
          />
        </Box>
      </LayoutContext.Provider>
      <LayoutContext.Provider value={generalLayout}>
        <Box display={attachmentTab ? "flex" : "none"} flexDirection="column" paddingX={PADDING_X} paddingY={1}>
          <AttachmentsTab
            ctx={ctx}
            storyId={storyId}
            selected={attachmentTab && confirming === null}
            onHints={setAttachmentHints}
            onTask={setAttachmentTask}
          />
        </Box>
      </LayoutContext.Provider>
      {confirming === "discard" && (
        <ConfirmDialog
          title="Discard changes"
          message="Close and discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={onClose}
          onCancel={() => onConfirming(null)}
        />
      )}
      {confirming === "delete" && (
        <ConfirmDialog
          title={onDelete.title}
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
      )}
    </Box>
  );
}
