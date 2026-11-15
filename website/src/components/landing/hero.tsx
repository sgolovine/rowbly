import { Link } from "@tanstack/react-router";
import { InstallCommand } from "@/components/install-command";
import { TerminalFrame } from "@/components/terminal-frame";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site";
import { BoardShot } from "./board-shot";

const inlineCodeClass = "font-mono text-brand-text";

/** The first section of the landing page. It has the only `<h1>` of the page. */
export function Hero() {
  return (
    <section className="px-4 pt-8 pb-16 sm:px-6 md:pt-16 md:pb-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
        <div className="min-w-0">
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-brand-text lg:text-5xl">
            A Kanban board in your repo, worked by Pi agents.
          </h1>
          <p className="mt-5 text-base text-brand-muted md:text-lg">
            Rowbly keeps Stories as Markdown and JSON in <code className={inlineCodeClass}>.rowbly/</code>. Each column
            has a prompt. A daemon runs a Pi supervisor that starts Pi workers on ready Stories: one Story, one worktree
            and one session per worker. You review the result and merge it.
          </p>
          <InstallCommand className="mt-6 max-w-md" />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link to="/install">Install</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                Source on GitHub
              </a>
            </Button>
          </div>
          <p className="mt-6 text-sm text-brand-muted">MIT licensed. Node 22.19+. The factory runs on Linux.</p>
        </div>
        <TerminalFrame className="min-w-0">
          <BoardShot />
        </TerminalFrame>
      </div>
    </section>
  );
}
