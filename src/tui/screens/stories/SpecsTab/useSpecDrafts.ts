import { useCallback, useEffect, useRef, useState } from "react";
import { type Spec, updateSpec } from "../../../../services/spec/spec.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useToast } from "../../../hooks/index.js";

/** How long the text must stay unchanged before it is written. */
const AUTOSAVE_MS = 500;

/** The text of an edited spec, and the last text that is in its file. */
interface Draft {
  text: string;
  written: string;
}

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

/**
 * The text of the specs in the editor, written to the files automatically: after a short pause in the
 * typing, and when the component unmounts. A draft stays after its write, so that the editor does not
 * change under the caret. One write runs at a time, so that an older text cannot replace a newer text.
 */
export function useSpecDrafts(ctx: ServiceContext): SpecDrafts {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const latest = useRef(drafts);
  latest.current = drafts;
  const writes = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    for (const [slug, { text, written }] of Object.entries(latest.current)) {
      if (text === written) continue;
      writes.current = writes.current
        .then(() => updateSpec({ slug, body: text }, ctx))
        .then(
          () =>
            setDrafts((prev) => {
              const draft = prev[slug];
              return draft ? { ...prev, [slug]: { ...draft, written: text } } : prev;
            }),
          (err: unknown) => toast.error(err),
        );
    }
  }, [ctx, toast]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `drafts` starts the pause again; `flush` reads it from the ref.
  useEffect(() => {
    const timer = setTimeout(flush, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [drafts, flush]);
  useEffect(() => flush, [flush]);

  return {
    textOf: (spec) => drafts[spec.slug]?.text ?? spec.body,
    isUnsaved: (spec) => {
      const draft = drafts[spec.slug];
      return draft !== undefined && draft.text !== draft.written;
    },
    edit: (spec, text) =>
      setDrafts((prev) => ({ ...prev, [spec.slug]: { text, written: prev[spec.slug]?.written ?? spec.body } })),
    flush,
    forget: (slug) => {
      const { [slug]: _dropped, ...rest } = latest.current;
      latest.current = rest;
      setDrafts(rest);
      return writes.current;
    },
  };
}
