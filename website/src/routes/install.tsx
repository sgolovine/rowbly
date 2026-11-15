import { createFileRoute } from "@tanstack/react-router";
import { Section } from "@/components/section";
import { pageHead } from "@/lib/seo";
import { DOCS_URL } from "@/lib/site";

export const Route = createFileRoute("/install")({
  head: () =>
    pageHead({
      path: "/install",
      title: "Install | Rowbly",
      description:
        "Install Rowbly with npm, open it in your Git repo and start the factory. Free and open source under MIT. Needs Node 22. The factory runs on Linux today.",
    }),
  component: InstallPage,
});

function InstallPage() {
  return (
    <Section headline="Install">
      <p className="text-brand-muted">
        This page is not ready yet. Read the{" "}
        <a href={DOCS_URL} className="text-brand-text underline underline-offset-4">
          README
        </a>{" "}
        for now.
      </p>
    </Section>
  );
}
