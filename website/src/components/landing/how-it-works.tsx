import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Kbd } from "@/components/kbd";
import { Section } from "@/components/section";
import { Card } from "@/components/ui/card";

/** A small drawing of a new Story card in the Backlog column. */
function StoryIllustration() {
  return (
    <div aria-hidden="true" className="flex h-20 flex-col justify-center gap-1.5 font-mono text-[10px]">
      <span className="text-brand-muted">Backlog</span>
      <div className="rounded border border-brand-border bg-brand-background px-2 py-1.5">
        <span className="text-brand-story-key">TTT-59</span>
        <span className="mt-1 block h-1.5 w-4/5 rounded-full bg-brand-border" />
      </div>
    </div>
  );
}

/** A small drawing of three Stages, each with a prompt line. */
function PromptIllustration() {
  return (
    <div aria-hidden="true" className="flex h-20 flex-col justify-center gap-1.5 font-mono text-[10px]">
      {["w-3/5", "w-4/5", "w-2/5"].map((width) => (
        <div key={width} className="flex items-center gap-1.5">
          <span className="text-brand-accent">›</span>
          <span className={`h-1.5 rounded-full bg-brand-border ${width}`} />
        </div>
      ))}
    </div>
  );
}

/** A small drawing of a supervisor that hands Stories to three workers. */
function FactoryIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 80" className="h-20 w-30 self-start" fill="none">
      <rect x="44" y="6" width="32" height="16" rx="3" className="stroke-brand-accent" strokeWidth="1.5" />
      <path d="M60 22v10M20 32h80M20 32v10M60 32v10M100 32v10" className="stroke-brand-border" strokeWidth="1.5" />
      {[4, 44, 84].map((x) => (
        <rect key={x} x={x} y="42" width="32" height="16" rx="3" className="stroke-brand-muted" strokeWidth="1.5" />
      ))}
      {[20, 60, 100].map((x) => (
        <circle key={x} cx={x} cy="70" r="2.5" className="fill-brand-accent" />
      ))}
    </svg>
  );
}

/** A small drawing of a branch that merges back into the main line. */
function MergeIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 80" className="h-20 w-30 self-start" fill="none">
      <path d="M10 60h100" className="stroke-brand-border" strokeWidth="2" />
      <path d="M30 60c0-30 20-30 40-30s30 0 40 30" className="stroke-brand-muted" strokeWidth="2" />
      <circle cx="30" cy="60" r="4" className="fill-brand-surface stroke-brand-muted" strokeWidth="2" />
      <circle cx="70" cy="30" r="4" className="fill-brand-surface stroke-brand-muted" strokeWidth="2" />
      <circle cx="104" cy="60" r="6" className="fill-brand-accent" />
    </svg>
  );
}

type Step = Readonly<{
  title: string;
  copy: ReactNode;
  illustration: ReactNode;
}>;

const inlineCodeClass = "font-mono text-brand-text";

/** The four steps from a new Story to a merged change. */
const STEPS: readonly Step[] = [
  {
    title: "Write a Story.",
    copy: (
      <>
        In the TUI or with <code className={inlineCodeClass}>rowbly story create</code>. One line is enough. The Story
        is a Markdown file and starts in Backlog.
      </>
    ),
    illustration: <StoryIllustration />,
  },
  {
    title: "Give each Stage a prompt.",
    copy: (
      <>
        A Stage prompt is a Markdown file in <code className={inlineCodeClass}>.rowbly/stages/</code>, for example
        &ldquo;Build it, open a PR, move it to In Review.&rdquo; Stages without work, like Backlog and Done, get no
        workers.
      </>
    ),
    illustration: <PromptIllustration />,
  },
  {
    title: "Start the factory.",
    copy: (
      <>
        Press <Kbd>f</Kbd> then <Kbd>s</Kbd>, or run <code className={inlineCodeClass}>rowbly factory start</code>. The
        supervisor picks ready Stories and starts workers, up to your worker limit. The default limit is 4.
      </>
    ),
    illustration: <FactoryIllustration />,
  },
  {
    title: "Review and merge.",
    copy: "Workers do what the Stage prompt says and move the Story on. Read any session while it runs, interrupt it, or resume it. The merge is yours.",
    illustration: <MergeIllustration />,
  },
];

/** The "How it works" section of the landing page: four steps from idea to pull request. */
export function HowItWorks() {
  return (
    <Section id="how-it-works" headline="How it works">
      <ol className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="min-w-0">
            <Card className="h-full gap-4 px-5 py-5">
              {step.illustration}
              <h3 className="flex items-baseline gap-2 font-semibold text-brand-text">
                <span aria-hidden="true" className="font-mono text-sm text-brand-accent">
                  {index + 1}
                </span>
                {step.title}
              </h3>
              <p className="text-sm text-brand-muted">{step.copy}</p>
            </Card>
          </li>
        ))}
      </ol>
      <Link
        to="/how-it-works"
        className="mt-8 inline-flex items-center gap-1.5 text-sm text-brand-text transition-colors hover:text-brand-accent"
      >
        The details
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </Section>
  );
}
