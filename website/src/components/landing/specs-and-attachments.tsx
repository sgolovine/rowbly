import { FileText, Paperclip } from "lucide-react";
import { Section } from "@/components/section";

/** The "Specs and attachments" section of the landing page. A small section without a large visual. */
export function SpecsAndAttachments() {
  return (
    <Section
      id="specs"
      eyebrow={
        <span className="inline-flex items-center gap-2 text-brand-accent">
          <FileText aria-hidden="true" className="size-5" />
          <Paperclip aria-hidden="true" className="size-5" />
        </span>
      }
      headline="Context that travels with the Story."
      subhead="Link a Markdown Spec to a Story so agents build what you meant. Paste a screenshot straight onto a Story. Everything stays next to the code."
    />
  );
}
