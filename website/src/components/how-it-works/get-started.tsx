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
      headline="Start your factory."
      subhead="Install Rowbly, open it in your repo, and the onboarding sets up your Stages and prompts."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <InstallCommand className="max-w-md" />
        <Button asChild size="lg">
          <Link to="/install">
            Read the install guide
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Section>
  );
}
