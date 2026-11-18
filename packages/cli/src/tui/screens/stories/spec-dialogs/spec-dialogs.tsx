import type { Spec } from "../../../../services/spec/spec.js";
import { ConfirmDialog, FormModal, type FormValues } from "../../../components/index.js";

/** What the Specs tab shows: the list, the editor, or a dialog for one spec. */
export type SpecMode =
  | { kind: "list" }
  | { kind: "edit" }
  | { kind: "new" }
  | { kind: "rename"; spec: Spec }
  | { kind: "remove"; spec: Spec };

export interface SpecDialogsProps {
  readonly mode: SpecMode;
  readonly storyId: string;
  /** May throw: the form shows the error. */
  readonly onCreate: (values: FormValues) => Promise<void>;
  /** May throw: the form shows the error. */
  readonly onRename: (spec: Spec, values: FormValues) => Promise<void>;
  readonly onRemove: (spec: Spec) => void;
  readonly onClose: () => void;
}

/** The question that confirms the removal of `spec` from the Story `storyId`. */
function removeMessage(spec: Spec, storyId: string): string {
  const others = spec.stories.filter((id) => id !== storyId);

  return others.length > 0
    ? `Remove ${spec.title} from ${storyId}? It stays linked to ${others.join(", ")}.`
    : `Delete ${spec.title}? You cannot undo this.`;
}

/** The dialog of the Specs tab for `mode`: a new spec, a new title, or the removal of a spec. */
export function SpecDialogs({ mode, storyId, onCreate, onRename, onRemove, onClose }: SpecDialogsProps) {
  return (
    <>
      {mode.kind === "new" && (
        <FormModal
          title="New Spec"
          fields={[{ name: "title", label: "Title", kind: "text", required: true }]}
          initialValues={{ title: "" }}
          submitOnEnter
          onSubmit={(values) => onCreate(values)}
          onClose={onClose}
        />
      )}
      {mode.kind === "rename" && (
        <FormModal
          title={`Rename Spec › ${mode.spec.title}`}
          fields={[{ name: "title", label: "Title", kind: "text", required: true }]}
          initialValues={{ title: mode.spec.title }}
          onSubmit={(values) => onRename(mode.spec, values)}
          onClose={onClose}
        />
      )}
      {mode.kind === "remove" && (
        <ConfirmDialog
          title={`Remove Spec › ${mode.spec.title}`}
          message={removeMessage(mode.spec, storyId)}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => onRemove(mode.spec)}
          onCancel={onClose}
        />
      )}
    </>
  );
}
