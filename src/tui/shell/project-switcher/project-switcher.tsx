import { type Key, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import { forgetProject, type KnownProject, listKnownProjects } from "../../../services/known-project/known-project.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { ConfirmDialog, Loading, Modal, modalSize, type SelectItem, SelectList } from "../../components/index.js";
import {
  type AsyncState,
  showToast,
  type ToastStore,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useLayout,
  useToast,
} from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { ProjectTag } from "../project-tag/index.js";

/** The most columns a name takes in a row, so the path has room. */
const NAME_WIDTH = 24;

/** What the handlers of the switcher read and change. */
interface SwitcherEnv {
  readonly ctx: ServiceContext;
  readonly current: string | undefined;
  readonly known: readonly KnownProject[];
  readonly projects: AsyncState<KnownProject[]>;
  readonly highlightedProject: KnownProject | undefined;
  readonly toast: ToastStore;
  readonly setRemoving: Dispatch<SetStateAction<KnownProject | undefined>>;
  readonly onSelect: (path: string) => void;
}

function cutEnd(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/** Cuts from the start, because the end of a path names the project. */
function cutStart(text: string, width: number): string {
  return text.length > width ? `…${text.slice(1 - width)}` : text;
}

function tagText(project: KnownProject, current: string | undefined): string {
  if (project.path === current) {
    return " · current";
  }

  return project.missing ? " · missing" : "";
}

/** The row of `project`: the name, the tag and as much of the path as fits in `width`. */
function projectItem(project: KnownProject, current: string | undefined, width: number): SelectItem {
  const name = cutEnd(project.name, NAME_WIDTH);
  // The bar, the name, the tag and the space before the path take the other columns of the row.
  const room = width - 3 - name.length - tagText(project, current).length;

  return {
    value: project.path,
    label: name,
    tag: <ProjectTag project={project} current={current} />,
    description: room >= 8 ? cutStart(project.path, room) : undefined,
  };
}

function switcherHints(highlighted: boolean): KeyHint[] {
  return [
    { key: "↑/↓", description: "select" },
    { key: "enter", description: "switch" },
    ...(highlighted ? [{ key: "d", description: "remove" }] : []),
    { key: "/", description: "filter" },
    { key: "esc", description: "close" },
  ];
}

/** A missing Project stays in the list with a warning; the others open. */
function pick(env: SwitcherEnv, path: string): void {
  const project = env.known.find((p) => p.path === path);

  if (project?.missing && path !== env.current) {
    showToast(env.toast, "warning", `${project.name} is no longer at ${path}`);

    return;
  }

  env.onSelect(path);
}

function switcherKey(env: SwitcherEnv, input: string, key: Key): void {
  if (input === "d" && !key.ctrl && !key.meta && env.highlightedProject) {
    env.setRemoving(env.highlightedProject);
  }
}

function removeProject(env: SwitcherEnv, project: KnownProject): void {
  forgetProject(project.path, env.ctx).then(
    () => removed(env, project),
    (err: unknown) => removeFailed(env, err),
  );
}

function removed(env: SwitcherEnv, project: KnownProject): void {
  showToast(env.toast, "info", `Removed ${project.name} from the list`);
  env.setRemoving(undefined);
  env.projects.reload();
}

function removeFailed(env: SwitcherEnv, err: unknown): void {
  env.toast.error(err);
  env.setRemoving(undefined);
}

/**
 * The Project switcher, in a generic Modal. It lists the Projects in `~/.rowblyrc.json`, the most recent
 * first, and starts on the most recent Project that is not open. `↑/↓` select, `enter` or a click switches,
 * and `d` removes the selected Project from the list after a confirmation. The Project itself stays on disk.
 */
export function ProjectSwitcher({
  ctx,
  current,
  onSelect,
  onClose,
}: {
  ctx: ServiceContext;
  /** The root of the open Project, if there is one. */
  current?: string;
  onSelect(path: string): void;
  onClose(): void;
}) {
  const active = useIsActive();
  const toast = useToast();
  const { body } = modalSize(useLayout(), { footer: true });
  const projects = useAsync(() => listKnownProjects(ctx), [ctx]);
  const [highlighted, setHighlighted] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const [removing, setRemoving] = useState<KnownProject>();

  const idle = active && !removing;
  const known = projects.data ?? [];
  const highlightedProject = known.find((p) => p.path === highlighted);
  const env: SwitcherEnv = { ctx, current, known, projects, highlightedProject, toast, setRemoving, onSelect };

  useKeyCapture(idle, { text: false, escape: true });
  useEscape(idle, onClose);
  useInput((input, key) => switcherKey(env, input, key), { isActive: idle && !filtering });

  return (
    <Modal title="Projects" onClose={onClose} hints={switcherHints(highlightedProject !== undefined)}>
      {projects.loading && !projects.data ? (
        <Loading label="Loading Projects…" />
      ) : (
        <SelectList
          items={known.map((project) => projectItem(project, current, body.width))}
          defaultIndex={Math.max(
            0,
            known.findIndex((p) => p.path !== current && !p.missing),
          )}
          onSelect={(item) => pick(env, item.value)}
          onHighlight={(item) => setHighlighted(item?.value)}
          onFilteringChange={setFiltering}
          isActive={!removing}
          emptyText="No Projects yet. Run rowbly in a Project to add it here."
          limit={Math.max(1, Math.min(10, (body.height ?? 12) - 2))}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove Project › ${removing.name}`}
          message={`Remove ${removing.name} from the list? Rowbly does not delete the files at ${removing.path}.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => removeProject(env, removing)}
          onCancel={() => setRemoving(undefined)}
        />
      )}
    </Modal>
  );
}
