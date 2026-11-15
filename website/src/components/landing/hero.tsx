import { Star } from "lucide-react";
import { InstallCommand } from "@/components/install-command";
import { TerminalFrame } from "@/components/terminal-frame";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site";
import { BoardShot } from "./board-shot";

/** The first section of the landing page. It has the only `<h1>` of the page. */
export function Hero() {
  return (
    <section className="px-4 pt-8 pb-16 sm:px-6 md:pt-16 md:pb-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
        <div className="min-w-0">
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-brand-text lg:text-5xl xl:text-6xl">
            Your backlog, built by a factory of agents.
          </h1>
          <p className="mt-5 text-base text-brand-muted md:text-lg">
            Rowbly is a software factory manager that lives in your terminal. Put Stories on a board. Tell each Stage
            what to do. Start the factory, and a team of AI agents refines, builds, opens PRs and reviews, all at once,
            while you watch.
          </p>
          <InstallCommand className="mt-6 max-w-md" />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href="#install">Get started</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#see-it-work">See it work</a>
            </Button>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-2 text-sm text-brand-muted transition-colors hover:text-brand-text"
            >
              <Star aria-hidden="true" className="size-4" />
              Star on GitHub
            </a>
          </div>
          <p className="mt-6 text-sm text-brand-muted">Free. Open source. MIT. Bring your own models.</p>
        </div>
        <TerminalFrame glow className="min-w-0">
          <BoardShot mode="tags" />
        </TerminalFrame>
      </div>
    </section>
  );
}
