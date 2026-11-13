import { Box } from "ink";
import { Button, ConfirmDialog, FormModal } from "../../../components/index.js";
import { AttachmentList } from "../attachment-list/index.js";
import { attachFile, confirmRemove, openItem } from "./attachments-tab-actions.js";
import { type AttachmentsTabProps, useAttachmentsTab } from "./use-attachments-tab.js";

/** The rows of the list: the layout height less the Buttons and the blank row above them. */
function listHeight(height: number | undefined): number | undefined {
  return height === undefined ? undefined : Math.max(1, height - 2);
}

/**
 * The saved images of one Story. The arrows select an image, `n` attaches a PNG from a path, `o` opens the
 * selected image and `d` asks before it removes the image. The list reads again when the tab is selected.
 */
export function AttachmentsTab(props: AttachmentsTabProps) {
  const { env, state, layout, items, task, idle } = useAttachmentsTab(props);
  const { item, setTask, setCursor } = env;

  return (
    <Box flexDirection="column" height={layout.height}>
      <AttachmentList
        items={items}
        item={item}
        active={idle}
        loading={state.loading}
        height={listHeight(layout.height)}
        onSelect={setCursor}
      />
      <Box gap={2} marginTop={1}>
        <Button compact label="New PNG" keyName="n" onClick={() => setTask("path")} clickable={idle} />
        <Button compact label="Open" keyName="o" onClick={() => openItem(env)} clickable={idle && !!item} />
        <Button
          compact
          label="Remove"
          keyName="d"
          onClick={() => setTask("remove")}
          clickable={idle && !!item}
          destructive
        />
      </Box>
      {task === "path" && (
        <FormModal
          title="Attach PNG"
          fields={[{ name: "path", label: "PNG path", kind: "text", required: true }]}
          initialValues={{ path: "" }}
          onClose={() => setTask(null)}
          submitOnEnter
          onSubmit={(values) => attachFile(env, values)}
        />
      )}
      {task === "remove" && item && (
        <ConfirmDialog
          title="Remove attachment"
          message={`Remove ${item.name}?`}
          destructive
          confirmLabel="Remove"
          cancelLabel="Keep"
          onCancel={() => setTask(null)}
          onConfirm={() => confirmRemove(env, item)}
        />
      )}
    </Box>
  );
}
