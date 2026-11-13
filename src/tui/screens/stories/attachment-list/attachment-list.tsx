import { Text } from "ink";
import type { Attachment } from "../../../../services/attachment/attachment.js";
import { ScrollBody, SelectionRow } from "../../../components/index.js";
import { formatDateTime, theme } from "../../../theme.js";

export interface AttachmentListProps {
  readonly items: readonly Attachment[];
  /** The selected attachment. */
  readonly item: Attachment | undefined;
  /** The list takes the keys and the clicks. */
  readonly active: boolean;
  readonly loading: boolean;
  /** The rows of the list, or undefined when the content sets the height. */
  readonly height: number | undefined;
  readonly onSelect: (index: number) => void;
}

/** The text of an empty list: a loading note, or how to add an image. */
function emptyText(loading: boolean): string {
  return loading ? "Loading attachments…" : "No attachments. Paste an image or press n to add a PNG file.";
}

/** The saved images of a Story: the name, the size and the creation time of each image. */
export function AttachmentList({ items, item, active, loading, height, onSelect }: AttachmentListProps) {
  return (
    <ScrollBody active={active} height={height}>
      {!items.length && <Text color={theme.inkFaint}>{emptyText(loading)}</Text>}
      {items.map((a, i) => (
        <SelectionRow key={a.id} selected={a.id === item?.id} active={active} onClick={() => onSelect(i)}>
          <Text color={theme.ink}>
            {a.name} · {a.size} bytes · {formatDateTime(a.createdAt)}
          </Text>
        </SelectionRow>
      ))}
    </ScrollBody>
  );
}
