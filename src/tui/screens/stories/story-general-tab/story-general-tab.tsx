import { Box } from "ink";
import {
  Button,
  Form,
  type FormField,
  FormNavigationContext,
  type FormValues,
  ScrollBody,
} from "../../../components/index.js";
import { PASTE_HINT } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { StoryDependencyLists } from "../story-dependency-lists/index.js";
import type { DependencyLists } from "../story-dependency-view.js";
import { StoryTimeRows, type StoryTimes } from "../story-time-rows/index.js";

const NO_HINTS: readonly KeyHint[] = [];
/** One list for all renders, so that the Form does not report its keys again on each render. */
const EXTRA_HINTS: readonly KeyHint[] = [PASTE_HINT];
/** The Form leaves `shift+tab` and the save key to the Story form, which changes the tab and asks the Form to save. */
const NAVIGATION = { extraHints: NO_HINTS, register: () => () => {} };

export interface StoryGeneralTabProps {
  readonly fields: readonly FormField[];
  readonly initialValues: FormValues;
  /** The saved upstream and downstream Stories, or undefined when the tab does not show them. */
  readonly dependencies: DependencyLists | undefined;
  /** The saved times of the Story, or undefined when the tab does not show them. */
  readonly times: StoryTimes | undefined;
  /** The rows of the scroll region, or undefined when the content sets the height. */
  readonly height: number | undefined;
  /** The scroll region and the Delete Button take the keys and the clicks. */
  readonly active: boolean;
  /** The Form takes the keys. */
  readonly formActive: boolean;
  /** A new value asks the Form to save. */
  readonly submitRequest: number;
  readonly onSubmit: (values: FormValues) => Promise<void>;
  /** Asks before it deletes the Story. */
  readonly onDelete: () => void;
  /** A click on an item of the dependency lists: opens the Story `id`. */
  readonly onOpenStory?: (id: string) => void;
}

/**
 * The General tab of the Story form: the Form of the Story, the saved dependencies, the Created and Updated times,
 * and the Delete Button under them.
 */
export function StoryGeneralTab({
  fields,
  initialValues,
  dependencies,
  times,
  height,
  active,
  formActive,
  submitRequest,
  onSubmit,
  onDelete,
  onOpenStory,
}: StoryGeneralTabProps) {
  return (
    <ScrollBody active={active} height={height}>
      <FormNavigationContext.Provider value={NAVIGATION}>
        <Form
          fields={fields}
          initialValues={initialValues}
          onSubmit={onSubmit}
          extraHints={EXTRA_HINTS}
          isActive={formActive}
          submitRequest={submitRequest}
        />
      </FormNavigationContext.Provider>
      {dependencies && <StoryDependencyLists lists={dependencies} onOpen={onOpenStory} clickable={active} />}
      {times && <StoryTimeRows times={times} />}
      <Box marginTop={1}>
        <Button label="Delete" keyName="ctrl+d" onClick={onDelete} clickable={active} compact destructive />
      </Box>
    </ScrollBody>
  );
}
