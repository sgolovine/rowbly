import { createFileRoute } from "@tanstack/react-router";
import { Section } from "@/components/section";
import { DOCS_URL } from "@/lib/site";

export const Route = createFileRoute("/how-it-works")({
  component: HowItWorksPage,
});

function HowItWorksPage() {
  return (
    <Section headline="How it works">
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
