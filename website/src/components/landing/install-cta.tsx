import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";

const INSTALL_COMMANDS = ["npm install -g rowbly", "cd your-repo", "rowbly"] as const;

/** The limits of the factory. The values agree with the README "Prerequisites". */
const LIMITS: readonly string[] = [
  "The board and the CLI run on any platform with Node 22.19 or later.",
  "The factory runs on Linux. It needs Git and util-linux flock.",
  "One host per Project. NFS and copied runtime folders are not supported.",
  "Rowbly is free. Your model provider bills you for tokens.",
];

/** The install section at the end of the landing page. */
export function InstallCta() {
  return (
    <Section id="install" headline="Install">
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
          </div>
        </TerminalFrame>
        <div className="min-w-0">
          <p className="text-brand-muted">
            The first run creates <code className="font-mono text-brand-text">.rowbly/</code> and asks for a Project
            name, Stages and agent skills. The defaults work.
          </p>
          <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-brand-muted marker:text-brand-border">
            {LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <Link
            to="/install"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-brand-text transition-colors hover:text-brand-accent"
          >
            Full install steps
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </Section>
  );
}
