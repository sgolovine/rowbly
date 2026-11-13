import { Box, Text } from "ink";
import type { Spec } from "../../../../services/spec/spec.js";
import { Button, Panel, SelectionRow } from "../../../components/index.js";
import { theme } from "../../../theme.js";

export interface SpecListPanelProps {
  readonly specs: readonly Spec[];
  readonly cursor: number;
  readonly width: number;
  readonly height: number | undefined;
  /** The list takes the keys. */
  readonly listing: boolean;
  /** The editor takes the keys. */
  readonly editing: boolean;
  /** `spec` has text that is not in its file yet. */
  readonly isUnsaved: (spec: Spec) => boolean;
  /** A click on the Panel while the editor has the keys. */
  readonly onFocusList: () => void;
  readonly onClickRow: (index: number) => void;
  readonly onNew: () => void;
}

/** The title of a spec in the list, with a mark when its text is not in its file yet. */
function rowTitle(spec: Spec, unsaved: boolean): string {
  return unsaved ? `${spec.title} *` : spec.title;
}

/** The list of the specs of a Story in the Specs tab, with the button that creates a spec. */
export function SpecListPanel({
  specs,
  cursor,
  width,
  height,
  listing,
  editing,
  isUnsaved,
  onFocusList,
  onClickRow,
  onNew,
}: SpecListPanelProps) {
  // The rows and the Button take clicks during an edit too, so that a click can leave the editor.
  const clickable = listing || editing;

  return (
    <Panel
      title="Specs"
      focused={listing}
      onClick={editing ? onFocusList : undefined}
      flexShrink={0}
      width={width}
      height={height}
      overflow="hidden"
    >
      {specs.length === 0 && <Text color={theme.inkFaint}>No Specs</Text>}
      {specs.map((spec, i) => (
        <SelectionRow key={spec.slug} selected={i === cursor} active={clickable} onClick={() => onClickRow(i)}>
          <Text color={theme.ink} bold={i === cursor} wrap="truncate-end">
            {rowTitle(spec, isUnsaved(spec))}
          </Text>
        </SelectionRow>
      ))}
      <Box marginTop={1}>
        <Button label="+ New Spec" keyName="n" onClick={onNew} clickable={clickable} compact />
      </Box>
    </Panel>
  );
}
