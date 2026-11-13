import { Box, Text } from "ink";
import type { Spec } from "../../../../services/spec/spec.js";
import { Panel, TextArea } from "../../../components/index.js";
import { theme } from "../../../theme.js";

export interface SpecPanelProps {
  readonly current: Spec | undefined;
  /** The text to show for `current`: its draft, or its body. */
  readonly text: string;
  readonly height: number | undefined;
  readonly editorWidth: number;
  readonly editorRows: number;
  /** The list takes the keys. */
  readonly listing: boolean;
  /** The editor takes the keys. */
  readonly editing: boolean;
  /** A click on the Panel while the list has the keys. */
  readonly onFocusEditor: () => void;
  readonly onChange: (spec: Spec, text: string) => void;
}

/** The selected spec of a Story in the Specs tab: its slug, its Stories and the editor of its Markdown text. */
export function SpecPanel({
  current,
  text,
  height,
  editorWidth,
  editorRows,
  listing,
  editing,
  onFocusEditor,
  onChange,
}: SpecPanelProps) {
  return (
    <Panel
      title={current?.title ?? "Spec"}
      focused={editing}
      onClick={listing && current ? onFocusEditor : undefined}
      flexGrow={1}
      flexShrink={1}
      height={height}
      overflow="hidden"
    >
      {current ? (
        <>
          <Text color={theme.inkFaint} wrap="truncate-end">
            {current.slug} · {current.stories.join(", ")}
          </Text>
          <Box marginTop={1}>
            <TextArea
              key={current.slug}
              value={text}
              onChange={(next) => onChange(current, next)}
              focus={editing}
              width={editorWidth}
              rows={editorRows}
              placeholder="Press enter to write this spec in Markdown."
              title={current.title}
            />
          </Box>
        </>
      ) : (
        <Text color={theme.inkFaint}>Press n to create a Spec.</Text>
      )}
    </Panel>
  );
}
