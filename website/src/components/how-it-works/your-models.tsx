import { KeyRound, Users, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { Section } from "@/components/section";

type ModelStep = Readonly<{
  title: string;
  Icon: typeof KeyRound;
  copy: ReactNode;
}>;

const MODEL_STEPS: readonly ModelStep[] = [
  {
    title: "Sign in to your providers",
    Icon: KeyRound,
    copy: (
      <>
        Sign in to Anthropic, OpenAI, Google Gemini and more. Use Settings, then AI, then Providers, or run{" "}
        <code className="font-mono text-brand-text">rowbly auth login</code>. Your keys stay out of your repo.
      </>
    ),
  },
  {
    title: "Pick two models",
    Icon: Workflow,
    copy: "Pick one model for the supervisor and one model for the workers. They can be different, for example a fast model to pick Stories and a strong model to write code.",
  },
  {
    title: "Set the worker limit",
    Icon: Users,
    copy: (
      <>
        Set how many workers run at the same time in Settings, then AI, then Limits, or with{" "}
        <code className="font-mono text-brand-text">rowbly factory configure --max-workers</code>. Change it any time.
      </>
    ),
  },
];

/** The "Your models" section of the "How it works" page: providers, models and the worker limit. */
export function YourModels() {
  return (
    <Section
      id="your-models"
      headline="Your models"
      subhead="Bring your own models. Rowbly is free. Your model provider bills you for the models you use."
    >
      <ol className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {MODEL_STEPS.map(({ title, Icon, copy }) => (
          <li key={title} className="min-w-0">
            <Icon aria-hidden="true" className="size-5 text-brand-muted" />
            <h3 className="mt-3 font-semibold text-brand-text">{title}</h3>
            <p className="mt-2 text-sm text-brand-muted">{copy}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
