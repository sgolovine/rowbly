import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { type Spec, updateSpec } from "../../../../services/spec/spec.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type ToastStore, useLatest, useToast, writeRef } from "../../../hooks/index.js";

/** How long the text must stay unchanged before it is written. */
const AUTOSAVE_MS = 500;

/** The text of an edited spec, and the last text that is in its file. */
interface Draft {
  readonly text: string;
  readonly written: string;
}

type Drafts = Readonly<Record<string, Draft>>;

export interface SpecDrafts {
  /** The text to show for `spec`. */
  textOf(spec: Spec): string;
  /** `spec` has text that is not in its file yet. */
  isUnsaved(spec: Spec): boolean;
  edit(spec: Spec, text: string): void;
  /** Writes all unsaved text now. */
  flush(): void;
  /** Drops the text of a spec, and resolves when the writes that started before have finished. */
  forget(slug: string): Promise<void>;
}

/** The environment of the writes of the drafts. */
interface DraftsEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  /** The drafts of the last render, or of the last `forget`. */
  readonly latest: RefObject<Drafts>;
  /** The last write in the chain: each write starts after the write before it. */
  readonly writes: RefObject<Promise<void>>;
  readonly setDrafts: Dispatch<SetStateAction<Drafts>>;
}

/** `drafts` with the draft of `slug` marked as written with `text`, if the draft is still there. */
function markWritten(drafts: Drafts, slug: string, text: string): Drafts {
  const draft = drafts[slug];

  return draft ? { ...drafts, [slug]: { ...draft, written: text } } : drafts;
}

/** `drafts` with the new text of `spec`. The written text stays, or is the body of the spec for a new draft. */
function withText(drafts: Drafts, spec: Spec, text: string): Drafts {
  return { ...drafts, [spec.slug]: { text, written: drafts[spec.slug]?.written ?? spec.body } };
}

/** True when the draft of `spec` has text that is not in its file yet. */
function draftUnsaved(drafts: Drafts, spec: Spec): boolean {
  const draft = drafts[spec.slug];

  return draft !== undefined && draft.text !== draft.written;
}

/** Adds a write of `text` to the file of `slug` to the end of the chain. */
function queueWrite(env: DraftsEnv, slug: string, text: string): void {
  writeRef(
    env.writes,
    env.writes.current
      .then(() => updateSpec({ slug, body: text }, env.ctx))
      .then(
        () => env.setDrafts((prev) => markWritten(prev, slug, text)),
        (err: unknown) => env.toast.error(err),
      ),
  );
}

/** Writes each draft whose text is not in its file yet. */
function flushDrafts(env: DraftsEnv): void {
  for (const [slug, { text, written }] of Object.entries(env.latest.current)) {
    if (text !== written) {
      queueWrite(env, slug, text);
    }
  }
}

/** Drops the draft of `slug`, and gives the end of the chain of writes. */
function forgetDraft(env: DraftsEnv, slug: string): Promise<void> {
  const { [slug]: _dropped, ...rest } = env.latest.current;

  writeRef(env.latest, rest);
  env.setDrafts(rest);

  return env.writes.current;
}

/**
 * The text of the specs in the editor, written to the files automatically: after a short pause in the
 * typing, and when the component unmounts. A draft stays after its write, so that the editor does not
 * change under the caret. One write runs at a time, so that an older text cannot replace a newer text.
 */
export function useSpecDrafts(ctx: ServiceContext): SpecDrafts {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Drafts>({});
  const latest = useLatest(drafts);
  const writes = useRef<Promise<void>>(Promise.resolve());

  // `latest` is the same ref on each render, so `flush` changes only with `ctx` and `toast`, as before.
  const flush = useCallback(() => flushDrafts({ ctx, toast, latest, writes, setDrafts }), [ctx, toast, latest]);
  const env: DraftsEnv = { ctx, toast, latest, writes, setDrafts };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `drafts` starts the pause again; `flush` reads it from the ref.
  useEffect(() => {
    const timer = setTimeout(flush, AUTOSAVE_MS);

    return () => clearTimeout(timer);
  }, [drafts, flush]);
  useEffect(() => flush, [flush]);

  return {
    textOf: (spec) => drafts[spec.slug]?.text ?? spec.body,
    isUnsaved: (spec) => draftUnsaved(drafts, spec),
    edit: (spec, text) => setDrafts((prev) => withText(prev, spec, text)),
    flush,
    forget: (slug) => forgetDraft(env, slug),
  };
}
