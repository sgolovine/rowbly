import { createFileRoute } from "@tanstack/react-router";
import { BuiltOnPi } from "@/components/landing/built-on-pi";
import { FilesInRepo } from "@/components/landing/files-in-repo";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { InstallCta } from "@/components/landing/install-cta";
import { TuiAndCli } from "@/components/landing/tui-and-cli";
import { HOME_DESCRIPTION, HOME_TITLE, pageHead, softwareApplicationScript } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    ...pageHead({ path: "/", title: HOME_TITLE, description: HOME_DESCRIPTION }),
    scripts: [softwareApplicationScript()],
  }),
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <BuiltOnPi />
      <FilesInRepo />
      <TuiAndCli />
      <InstallCta />
    </>
  );
}
