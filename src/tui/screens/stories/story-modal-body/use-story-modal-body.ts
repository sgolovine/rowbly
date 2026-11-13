import { useInput } from "ink";
import { useMemo, useRef, useState } from "react";
import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type FormField, type FormModalDelete, type FormValues, useCovered } from "../../../components/index.js";
import { type Layout, useEscape, useIsActive, useKeyCapture, useLayout, useStoryPaste } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import type { StoryConfirm } from "../story-confirm-dialogs/index.js";
import type { StoryTabId, StoryTabReports } from "../story-tab-panes/index.js";
import type { StageNames } from "../thread-text.js";
import { useReportHints } from "../use-report-hints.js";
import { handleBodyKey, type StoryModalBodyEnv } from "./story-modal-body-actions.js";
import {
  generalLayoutOf,
  specsLayoutOf,
  storyModalHints,
  storyTabIds,
  storyTabLabels,
} from "./story-modal-body-view.js";

const NO_HINTS: readonly KeyHint[] = [];

export interface StoryModalBodyProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** The names of the Stages by key, for the Threads tab. */
  readonly stages?: StageNames;
  readonly specs?: boolean;
  readonly fields: readonly FormField[];
  readonly initialValues: FormValues;
  onSubmit(values: FormValues, attachments?: readonly PendingImage[]): void | Promise<void>;
  /** Closes the Modal now. */
  onClose(): void;
  /** Closes the Modal, or asks first if there are unsaved changes. */
  onRequestClose(): void;
  readonly onDelete: FormModalDelete;
  readonly confirming: StoryConfirm;
  onConfirming(confirm: StoryConfirm): void;
  /** The keys of the tab on the screen, for the hint strip of the Modal. */
  onHints(hints: readonly KeyHint[]): void;
}

/** The state of the Story Modal that its render reads. */
export interface StoryModalBodyState {
  readonly env: StoryModalBodyEnv;
  readonly layout: Layout;
  /** No confirmation is on top, and the Modal has the keys. */
  readonly idle: boolean;
  readonly labels: readonly string[];
  readonly reports: StoryTabReports;
  readonly submitRequest: number;
  readonly generalLayout: Layout;
  readonly specsLayout: Layout;
}

/** The counts, the key hints and the editing states that the tabs report. */
function useTabReports() {
  const [specCount, setSpecCount] = useState<number | undefined>(undefined);
  const [threadCount, setThreadCount] = useState<number | undefined>(undefined);
  const [threadViewing, setThreadViewing] = useState(false);
  const [threadHints, setThreadHints] = useState<readonly KeyHint[]>(NO_HINTS);
  const [specEditing, setSpecEditing] = useState(false);
  const [specHints, setSpecHints] = useState<readonly KeyHint[]>(NO_HINTS);
  const [attachmentHints, setAttachmentHints] = useState<readonly KeyHint[]>(NO_HINTS);
  const [attachmentTask, setAttachmentTask] = useState(false);

  const reports: StoryTabReports = {
    setSpecCount,
    setSpecEditing,
    setSpecHints,
    setThreadCount,
    setThreadViewing,
    setThreadHints,
    setAttachmentHints,
    setAttachmentTask,
  };

  return {
    reports,
    values: {
      specCount,
      threadCount,
      threadViewing,
      threadHints,
      specEditing,
      specHints,
      attachmentHints,
      attachmentTask,
    },
  };
}

/** The tabs, the keys, the hints and the save of the Story Modal. */
export function useStoryModalBody(props: StoryModalBodyProps): StoryModalBodyState {
  const { ctx, storyId, specs = true, confirming, onRequestClose, onHints } = props;
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const tabIds = storyTabIds(specs);
  const [tabId, setTabId] = useState<StoryTabId>("general");
  const { reports, values } = useTabReports();
  const [submitRequest, setSubmitRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);

  const tab = Math.max(0, tabIds.indexOf(tabId));
  const shown = tabIds[tab] ?? "general";
  const idle = active && !covered && confirming === null;
  // A sub-region of a tab that takes `esc` and `tab` for itself.
  const tabOwnsKeys = values.specEditing || values.threadViewing;
  const paste = useStoryPaste(`${ctx.cwd ?? ""}:${storyId}`, storyId, idle && !saving);
  const summaryRows = paste.summary ? 1 : 0;
  const hints = storyModalHints(shown, { ...values, tabOwnsKeys });

  const env: StoryModalBodyEnv = {
    tabIds,
    tab,
    shown,
    specEditing: values.specEditing,
    attachmentTask: values.attachmentTask,
    paste,
    savingNow,
    setTabId,
    setSubmitRequest,
    setSaving,
    onSubmit: props.onSubmit,
    onConfirming: props.onConfirming,
  };

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle && !tabOwnsKeys && !values.attachmentTask, onRequestClose);
  useInput((input, key) => handleBodyKey(env, input, key), { isActive: idle });
  useReportHints(onHints, hints);

  const generalLayout = useMemo(
    () => generalLayoutOf(layout.width, layout.height, summaryRows),
    [layout.width, layout.height, summaryRows],
  );
  const specsLayout = useMemo(
    () => specsLayoutOf(layout.width, layout.height, summaryRows),
    [layout.width, layout.height, summaryRows],
  );
  const labels = storyTabLabels(specs, values.specCount, values.threadCount);

  return { env, layout, idle, labels, reports, submitRequest, generalLayout, specsLayout };
}
