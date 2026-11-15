import type { ReactNode } from "react";
import { Section } from "@/components/section";
import { Card } from "@/components/ui/card";
import { PI_URL } from "@/lib/site";

const inlineCodeClass = "font-mono text-brand-text";

type PiFact = Readonly<{
  title: string;
  copy: ReactNode;
}>;

/** The parts of Pi that the factory uses without changes. */
const PI_FACTS: readonly PiFact[] = [
  {
    title: "Your Pi login",
    copy: (
      <>
        Rowbly reads credentials from Pi&apos;s credential store. If you are signed in to Pi, the factory can use that
        login. <code className={inlineCodeClass}>rowbly auth login</code> writes to the same store.
      </>
    ),
  },
  {
    title: "Pi models",
    copy: (
      <>
        Models use Pi&apos;s <code className={inlineCodeClass}>provider/model</code> IDs and thinking levels. If you do
        not pick a model, Pi picks its default.
      </>
    ),
  },
  {
    title: "Pi tools and sessions",
    copy: (
      <>
        Workers use Pi&apos;s <code className={inlineCodeClass}>read</code>,{" "}
        <code className={inlineCodeClass}>edit</code>, <code className={inlineCodeClass}>write</code> and{" "}
        <code className={inlineCodeClass}>bash</code> tools, and load <code className={inlineCodeClass}>AGENTS.md</code>
        . Each worker is a normal Pi session.
      </>
    ),
  },
];

/** The "Built on Pi" section of the landing page. */
export function BuiltOnPi() {
  return (
    <Section
      id="pi"
      headline="Built on Pi"
      subhead={
        <>
          Rowbly does not have its own agent loop. The supervisor and the workers are sessions of the{" "}
          <a href={PI_URL} target="_blank" rel="noreferrer" className="text-brand-text underline underline-offset-4">
            Pi
          </a>{" "}
          coding agent SDK. If you know how Pi behaves, you know how the workers behave.
        </>
      }
    >
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PI_FACTS.map((fact) => (
          <li key={fact.title} className="min-w-0">
            <Card className="h-full gap-3 px-5 py-5">
              <h3 className="font-semibold text-brand-text">{fact.title}</h3>
              <p className="text-sm text-brand-muted">{fact.copy}</p>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}
