import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { InstallCommand } from "@/components/install-command";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";

/** The call to action at the end of the "How it works" page. It sends the visitor to `/install`. */
export function GetStarted() {
  return (
    <Section
      id="get-started"
      headline="Install"
      subhead="Install Rowbly and run it in a Git repo. The first run creates the Stages and the prompt files."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <InstallCommand className="max-w-md" />
        <Button asChild size="lg">
          <Link to="/install">
            Install steps
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Section>
  );
}
