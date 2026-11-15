import { Section } from "@/components/section";
import { Card } from "@/components/ui/card";

type StagePrompt = Readonly<{
  stage: string;
  prompt: string;
}>;

/** The example prompts of section 4, step 2 of the Spec `website-content-plan`. Keep them word for word. */
const STAGE_PROMPTS: readonly StagePrompt[] = [
  { stage: "In Refinement", prompt: "Turn this into a spec with acceptance criteria." },
  { stage: "In Development", prompt: "Build it, open a PR, move it to review." },
  { stage: "In Review", prompt: "Review the PR." },
];

/** The "Stage prompts" section of the "How it works" page: three example prompts as cards. */
export function StagePrompts() {
  return (
    <Section
      id="stage-prompts"
      headline="Stage prompts"
      subhead="A Stage prompt is the whole job description. Change the prompt and every agent that enters that Stage changes with it."
    >
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {STAGE_PROMPTS.map(({ stage, prompt }) => (
          <li key={stage} className="min-w-0">
            <Card className="h-full gap-3 px-5 py-5">
              <h3 className="font-mono text-sm text-brand-muted">{stage}</h3>
              <p className="font-mono text-sm text-brand-text">
                <span aria-hidden="true" className="mr-2 text-brand-muted">
                  ›
                </span>
                {prompt}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex max-w-prose flex-col gap-4 text-brand-muted">
        <p>
          You write each prompt once, in plain English. It is a Markdown file in your repo, so you can read it, change
          it and review the change like code.
        </p>
        <p>
          These three Stages are only an example. You can add your own Stages, for example a Stage that writes the
          changelog. A Stage whose prompt gives an agent work gets workers. Backlog and Done get no work.
        </p>
      </div>
    </Section>
  );
}
