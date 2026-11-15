import type { ReactNode } from "react";
import { InstallCommand } from "@/components/install-command";
import { Kbd } from "@/components/kbd";
import { Card } from "@/components/ui/card";

/** One part of a step: text or a command with a copy button. */
type StepPart =
  | Readonly<{ kind: "text"; id: string; text: ReactNode }>
  | Readonly<{ kind: "command"; command: string }>;

type Step = Readonly<{
  title: string;
  parts: readonly StepPart[];
}>;

/** The CLI command that sets the factory models and the worker limit. */
const CONFIGURE_COMMAND =
  "rowbly factory configure --supervisor <provider/model> --worker <provider/model> --max-workers 4";

/** The numbered steps of the Install page. Each command exists in the current CLI. */
const STEPS: readonly Step[] = [
  {
    title: "Install",
    parts: [
      { kind: "command", command: "npm install -g rowbly" },
      { kind: "text", id: "text-1", text: "You can also use Rowbly without a global install:" },
      { kind: "command", command: "npx rowbly" },
    ],
  },
  {
    title: "First run",
    parts: [
      { kind: "text", id: "text-2", text: "Open your Git repo and start the board:" },
      { kind: "command", command: "cd your-repo" },
      { kind: "command", command: "rowbly" },
      {
        kind: "text",
        id: "text-3",
        text: "The first run asks for a Project name, Stages and agent skills. The defaults work.",
      },
    ],
  },
  {
    title: "Connect a model provider",
    parts: [
      {
        kind: "text",
        id: "text-6",
        text: "Rowbly uses Pi's credential store. If you are already signed in to Pi, skip the login. If not, run:",
      },
      { kind: "command", command: "rowbly auth login" },
      {
        kind: "text",
        id: "text-4",
        text: "Optional: pick a supervisor model, a worker model and a worker limit in Settings > AI, or with the CLI. Without a choice, Pi picks its default model and the limit is 4.",
      },
      { kind: "command", command: CONFIGURE_COMMAND },
    ],
  },
  {
    title: "Start the factory",
    parts: [
      {
        kind: "text",
        id: "text-5",
        text: (
          <>
            In the board, press <Kbd>f</Kbd> then <Kbd>s</Kbd>. Or run this command:
          </>
        ),
      },
      { kind: "command", command: "rowbly factory start" },
    ],
  },
];

/** The text or the command of one step part. */
function StepPartView({ part }: Readonly<{ part: StepPart }>) {
  if (part.kind === "command") {
    return <InstallCommand command={part.command} />;
  }
  return <p className="text-sm text-brand-muted">{part.text}</p>;
}

/** The numbered cards of the Install page, from the install to the first factory run. */
export function InstallSteps() {
  return (
    <ol className="flex flex-col gap-4">
      {STEPS.map((step, index) => (
        <li key={step.title} className="min-w-0">
          <Card className="gap-4 px-5 py-5">
            <h3 className="flex items-baseline gap-2 text-lg font-semibold text-brand-text">
              <span aria-hidden="true" className="font-mono text-sm text-brand-accent">
                {index + 1}
              </span>
              {step.title}
            </h3>
            {step.parts.map((part) => (
              <StepPartView key={part.kind === "command" ? part.command : part.id} part={part} />
            ))}
          </Card>
        </li>
      ))}
    </ol>
  );
}
