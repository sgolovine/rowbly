import { createFileRoute } from "@tanstack/react-router";
import { Section } from "@/components/section";
import { DOCS_URL } from "@/lib/site";

export const Route = createFileRoute("/install")({
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
