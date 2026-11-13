import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import {
  createSpec,
  deleteSpec,
  listSpecs,
  type Spec,
  unlinkSpec,
  updateSpec,
} from "../../../../services/spec/spec.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  Button,
  ConfirmDialog,
  FormModal,
  Loading,
  PANEL_FRAME_HEIGHT,
  PANEL_FRAME_WIDTH,
  Panel,
  SelectionRow,
  TextArea,
  useCovered,
} from "../../../components/index.js";
import { useAsync, useCursor, useEscape, useIsActive, useLayout, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { useSpecDrafts } from "./use-spec-drafts.js";

type Mode =
  | { kind: "list" }
  | { kind: "edit" }
  | { kind: "new" }
  | { kind: "rename"; spec: Spec }
  | { kind: "remove"; spec: Spec };

/** The width of the spec list with its frame, and the gap after it. */
const LIST_WIDTH = 26;
const GAP = 1;
/** The rows of the editor when the layout has no height (tests and piped output). */
const DEFAULT_ROWS = 10;
/** The frame, the Stories row, the blank row and the Full screen row around the editor. */
const EDITOR_CHROME = PANEL_FRAME_HEIGHT + 3;

/** The question that confirms the removal of `spec` from the Story `storyId`. */
function removeMessage(spec: Spec, storyId: string): string {
  const others = spec.stories.filter((id) => id !== storyId);
  return others.length > 0
    ? `Remove ${spec.title} from ${storyId}? It stays linked to ${others.join(", ")}.`
    : `Delete ${spec.title}? You cannot undo this.`;
}

/**
 * The specs of one Story, in two Panels: the list on the left and the Markdown text of the selected spec on
 * the right. `enter`, `tab` or a click on the text edits it. `tab`, `esc` or a click in the list goes back to
 * the list. The text saves automatically, and `ctrl+s` saves it at once. `n` creates a spec, `r` renames it
 * and `d` removes it from the Story. A spec with no other Story is deleted.
 */
export function SpecsTab({
  ctx,
  storyId,
  selected,
  onCount,
  onEditing,
  onHints,
}: {
  ctx: ServiceContext;
  storyId: string;
  /** This tab is the tab on the screen, and takes the keys. */
  selected: boolean;
  onCount(count: number): void;
  /** The text editor takes `esc`, so that the Modal does not close. */
  onEditing(editing: boolean): void;
  onHints(hints: readonly KeyHint[]): void;
}) {
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const drafts = useSpecDrafts(ctx);
  const [selectSlug, setSelectSlug] = useState<string | null>(null);
  const list = useAsync(() => listSpecs({ story: storyId }, ctx), [ctx, storyId]);
  const specs = list.data ?? [];
  const keysOwn = active && selected && !covered;
  const listing = keysOwn && mode.kind === "list" && list.data !== undefined;
  const editing = keysOwn && mode.kind === "edit";
  // The rows and the Button take clicks during an edit too, so that a click can leave the editor.
  const clickable = listing || editing;
  const [cursor, setCursor] = useCursor(specs.length, listing);
  const current = specs[cursor];

  const count = list.data?.length;
  useEffect(() => {
    if (count !== undefined) {
      onCount(count);
    }
  }, [count, onCount]);
  useEffect(() => onEditing(editing), [editing, onEditing]);
  // A new spec is in the list after the reload: the cursor moves to it there, and its text opens.
  useEffect(() => {
    if (selectSlug === null) {
      return;
    }
    const index = specs.findIndex((spec) => spec.slug === selectSlug);
    if (index === -1) {
      return;
    }
    setCursor(index);
    setSelectSlug(null);
    setMode({ kind: "edit" });
  }, [selectSlug, specs, setCursor]);
  useEffect(() => {
    if (mode.kind === "edit" && !current && list.data !== undefined) {
      setMode({ kind: "list" });
    }
  }, [mode.kind, current, list.data]);

  const remove = (spec: Spec) => {
    const shared = spec.stories.some((id) => id !== storyId);
    drafts
      .forget(spec.slug)
      .then(() =>
        shared ? unlinkSpec({ slug: spec.slug, story: storyId }, ctx) : deleteSpec({ slug: spec.slug }, ctx),
      )
      .then(() => {
        toast.push("info", shared ? `Removed ${spec.title} from ${storyId}` : `Deleted ${spec.title}`);
        setMode({ kind: "list" });
        list.reload();
      })
      .catch((err: unknown) => {
        toast.error(err);
        setMode({ kind: "list" });
      });
  };

  useEscape(editing, () => setMode({ kind: "list" }));
  useInput(
    (input, key) => {
      if (key.ctrl && input === "s") {
        drafts.flush();
      } else if (key.tab && !key.shift) {
        setMode({ kind: "list" });
      }
    },
    { isActive: editing },
  );
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) {
        return;
      }
      if (input === "n") {
        setMode({ kind: "new" });
      } else if (current && (key.return || (key.tab && !key.shift))) {
        setMode({ kind: "edit" });
      } else if (current && input === "r") {
        setMode({ kind: "rename", spec: current });
      } else if (current && input === "d") {
        setMode({ kind: "remove", spec: current });
      }
    },
    { isActive: listing },
  );

  const hints: readonly KeyHint[] = !keysOwn
    ? []
    : editing
      ? [
          { key: "ctrl+s", description: "save" },
          { key: "ctrl+f", description: "full screen" },
          { key: "tab", description: "specs", secondary: true },
          { key: "esc", description: "back to specs" },
        ]
      : [
          ...(specs.length > 0 ? [{ key: "↑/↓", description: "select" }] : []),
          ...(current ? [{ key: "enter/tab", description: "edit" }] : []),
          { key: "n", description: "new Spec" },
          ...(current
            ? [
                { key: "r", description: "rename" },
                { key: "d", description: "remove" },
              ]
            : []),
        ];
  const hintsKey = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hintsKey` stands in for `hints`, which is new on each render.
  useEffect(() => onHints(hints), [hintsKey, onHints]);

  if (!list.data) {
    return list.loading ? <Loading label="Loading the specs…" /> : null;
  }
  const editorWidth = Math.max(20, layout.width - LIST_WIDTH - GAP - PANEL_FRAME_WIDTH);
  const rows = layout.height === undefined ? DEFAULT_ROWS : Math.max(3, layout.height - EDITOR_CHROME);
  return (
    <Box columnGap={GAP} height={layout.height}>
      <Panel
        title="Specs"
        focused={listing}
        onClick={editing ? () => setMode({ kind: "list" }) : undefined}
        flexShrink={0}
        width={LIST_WIDTH}
        height={layout.height}
        overflow="hidden"
      >
        {specs.length === 0 && <Text color={theme.inkFaint}>No Specs</Text>}
        {specs.map((spec, i) => (
          <SelectionRow
            key={spec.slug}
            selected={i === cursor}
            active={clickable}
            onClick={() => {
              if (i === cursor) {
                setMode({ kind: "edit" });
              } else {
                setCursor(i);
                setMode({ kind: "list" });
              }
            }}
          >
            <Text color={theme.ink} bold={i === cursor} wrap="truncate-end">
              {drafts.isUnsaved(spec) ? `${spec.title} *` : spec.title}
            </Text>
          </SelectionRow>
        ))}
        <Box marginTop={1}>
          <Button
            label="+ New Spec"
            keyName="n"
            onClick={() => setMode({ kind: "new" })}
            clickable={clickable}
            compact
          />
        </Box>
      </Panel>
      <Panel
        title={current?.title ?? "Spec"}
        focused={editing}
        onClick={listing && current ? () => setMode({ kind: "edit" }) : undefined}
        flexGrow={1}
        flexShrink={1}
        height={layout.height}
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
                value={drafts.textOf(current)}
                onChange={(text) => drafts.edit(current, text)}
                focus={editing}
                width={editorWidth}
                rows={rows}
                placeholder="Press enter to write this spec in Markdown."
                title={current.title}
              />
            </Box>
          </>
        ) : (
          <Text color={theme.inkFaint}>Press n to create a Spec.</Text>
        )}
      </Panel>
      {mode.kind === "new" && (
        <FormModal
          title="New Spec"
          fields={[{ name: "title", label: "Title", kind: "text", required: true }]}
          initialValues={{ title: "" }}
          submitOnEnter
          onSubmit={async (values) => {
            const spec = await createSpec({ title: String(values.title ?? ""), stories: [storyId] }, ctx);
            toast.push("info", `Created ${spec.title}`);
            setSelectSlug(spec.slug);
            setMode({ kind: "list" });
            list.reload();
          }}
          onClose={() => setMode({ kind: "list" })}
        />
      )}
      {mode.kind === "rename" && (
        <FormModal
          title={`Rename Spec › ${mode.spec.title}`}
          fields={[{ name: "title", label: "Title", kind: "text", required: true }]}
          initialValues={{ title: mode.spec.title }}
          onSubmit={async (values) => {
            const spec = await updateSpec({ slug: mode.spec.slug, title: String(values.title ?? "") }, ctx);
            toast.push("info", `Renamed to ${spec.title}`);
            setMode({ kind: "list" });
            list.reload();
          }}
          onClose={() => setMode({ kind: "list" })}
        />
      )}
      {mode.kind === "remove" && (
        <ConfirmDialog
          title={`Remove Spec › ${mode.spec.title}`}
          message={removeMessage(mode.spec, storyId)}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => remove(mode.spec)}
          onCancel={() => setMode({ kind: "list" })}
        />
      )}
    </Box>
  );
}
