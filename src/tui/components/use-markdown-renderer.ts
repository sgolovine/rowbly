import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { loadMarkdownRenderer, type MarkdownRenderer, markdownRenderer } from "./markdown.js";

/** Loads the renderer, if it is not loaded. Gives the cleanup that drops a result that arrives after it. */
function loadRenderer(
  render: MarkdownRenderer | undefined,
  setRender: Dispatch<SetStateAction<MarkdownRenderer | undefined>>,
): (() => void) | undefined {
  if (render) {
    return undefined;
  }

  const live = new AbortController();

  void loadMarkdownRenderer().then((loaded) => live.signal.aborted || setRender(() => loaded));

  return () => live.abort();
}

/** The markdown renderer: `undefined` until it loads, then the renderer. The first use starts the load. */
export function useMarkdownRenderer(): MarkdownRenderer | undefined {
  const [render, setRender] = useState(markdownRenderer);

  useEffect(() => loadRenderer(render, setRender), [render]);

  return render;
}
