import { Section } from "@/components/section";
import { Card } from "@/components/ui/card";

type StagePrompt = Readonly<{
  stage: string;
  prompt: string;
}>;

/** Example Stage prompts. A real prompt is usually longer. */
const STAGE_PROMPTS: readonly StagePrompt[] = [
  { stage: "In Refinement", prompt: "Turn this into a spec with acceptance criteria." },
  { stage: "In Development", prompt: "Build it, open a PR, move it to In Review." },
  { stage: "In Review", prompt: "Review the PR." },
];

type PromptFile = Readonly<{
  file: string;
  who: string;
}>;

/** The user prompts of a Project, in the order of priority after the system prompts. */
const PROMPT_FILES: readonly PromptFile[] = [
  { file: ".rowbly/stages/<KEY>.md", who: "Workers in that Stage" },
  { file: ".rowbly/prompts/SUPERVISOR.md", who: "The supervisor" },
  { file: ".rowbly/prompts/WORKER.md", who: "All workers" },
  { file: ".rowbly/prompts/SYSTEM.md", who: "The supervisor and all workers" },
];

/** The "Stage prompts" section of the "How it works" page: example prompts and the prompt files. */
export function StagePrompts() {
  return (
    <Section
      id="stage-prompts"
      headline="Prompts"
      subhead="A Stage prompt tells a worker what to do with a Story in that Stage. Change the prompt, and the next worker in that Stage does the new thing."
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
      <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="flex max-w-prose flex-col gap-4 text-brand-muted">
          <p>
            The Stages are yours to define. Add a Stage for docs, for a changelog or for a security pass. The supervisor
            reads each Stage prompt and classifies the Stage as work or hold. Only work Stages get workers.
          </p>
          <p>
            Every agent gets the Rowbly system prompts first. Your prompts cannot remove a system rule. Then come your
            prompt files, in the order in the table. A missing file is skipped.
          </p>
        </div>
        <table className="w-full text-left font-mono text-xs sm:text-sm">
          <thead className="text-brand-muted">
            <tr className="border-b border-brand-border">
              <th className="py-2 pr-4 font-normal">File</th>
              <th className="py-2 font-normal">Who gets it</th>
            </tr>
          </thead>
          <tbody>
            {PROMPT_FILES.map(({ file, who }) => (
              <tr key={file} className="border-b border-brand-border">
                <td className="py-2 pr-4 break-all text-brand-text">{file}</td>
                <td className="py-2 text-brand-muted">{who}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
