import { Link } from "@tanstack/react-router";
import { Kbd } from "@/components/kbd";
import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site";

const INSTALL_COMMANDS = ["npm install -g rowbly", "cd your-repo", "rowbly"] as const;

/** The final call to action of the landing page. The "Get started" button of the Hero links here. */
export function InstallCta() {
  return (
    <Section id="install" headline="Start your factory in two minutes.">
      <div className="grid items-start gap-10 lg:grid-cols-2">
        <TerminalFrame className="min-w-0">
          <div className="overflow-x-auto p-4 font-mono text-sm">
            {INSTALL_COMMANDS.map((command) => (
              <p key={command} className="whitespace-pre text-brand-text">
                <span aria-hidden="true" className="mr-2 text-brand-muted select-none">
                  $
                </span>
                {command}
              </p>
            ))}
            <p className="mt-3 font-semibold text-brand-text">
              rowbly
              <span aria-hidden="true" className="cursor-blink text-brand-accent">
                _
              </span>
            </p>
          </div>
        </TerminalFrame>
        <div className="min-w-0">
          <p className="text-lg text-brand-muted">
            Onboarding sets up your Stages and prompts. Sign in to a provider, press <Kbd>f</Kbd> then <Kbd>s</Kbd>, and
            watch the board move.
          </p>
          <p className="mt-4 text-lg text-brand-muted">
            Free and open source under MIT. Needs Node 22 or later. The factory runs on Linux today.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link to="/install">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
