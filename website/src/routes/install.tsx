import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { InstallSteps } from "@/components/install/install-steps";
import { Section } from "@/components/section";
import { DOCS_URL } from "@/lib/site";

export const Route = createFileRoute("/install")({
  component: InstallPage,
});

/** The requirements of Rowbly. The values agree with `engines.node` and the README "Prerequisites". */
const REQUIREMENTS: readonly string[] = [
  "Node 22.19 or later.",
  "Git.",
  "Linux for the factory.",
  "The board and the CLI work without a provider sign-in.",
];

type NoteProps = Readonly<{
  title: string;
  children: ReactNode;
}>;

/** A short text block after the numbered steps. */
function Note({ title, children }: NoteProps) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold tracking-tight text-brand-text">{title}</h2>
      <p className="text-brand-muted">{children}</p>
    </div>
  );
}

/** The Install page: requirements, the first commands and the first factory run. */
function InstallPage() {
  return (
    <Section>
      <div className="mx-auto flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight text-brand-text md:text-5xl">Install Rowbly</h1>
          <p className="text-lg text-brand-muted">From install to your first factory run in a few commands.</p>
        </header>

        <section aria-labelledby="requirements" className="flex flex-col gap-4">
          <h2 id="requirements" className="text-xl font-semibold tracking-tight text-brand-text">
            Requirements
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-brand-muted marker:text-brand-border">
            {REQUIREMENTS.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
          <p className="text-brand-text">
            You can use the board on any platform. The factory itself runs on Linux today.
          </p>
        </section>

        <section aria-labelledby="steps" className="flex flex-col gap-4">
          <h2 id="steps" className="text-xl font-semibold tracking-tight text-brand-text">
            Get started
          </h2>
          <InstallSteps />
        </section>

        <Note title="Costs">Rowbly is free. Your model provider bills you for the models you use.</Note>
        <Note title="Your keys">
          Your keys stay on your machine. Rowbly sends them only to the provider you signed in to.
        </Note>

        <a
          href={DOCS_URL}
          className="inline-flex items-center gap-1.5 self-start text-brand-text transition-colors hover:text-brand-accent"
        >
          Read the full docs on GitHub
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </div>
    </Section>
  );
}
