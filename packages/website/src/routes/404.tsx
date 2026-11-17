import { createFileRoute } from "@tanstack/react-router";
import { NotFoundPage } from "@/components/not-found-page";

// The build prerenders this route to `404.html`. GitHub Pages serves that file for each unknown path.
export const Route = createFileRoute("/404")({
  head: () => ({
    meta: [{ title: "Page not found | Rowbly" }, { name: "robots", content: "noindex" }],
  }),
  component: NotFoundPage,
});
