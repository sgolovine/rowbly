import { createFileRoute } from "@tanstack/react-router";
import { BringYourModels } from "@/components/landing/bring-your-models";
import { FilesInRepo } from "@/components/landing/files-in-repo";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { InstallCta } from "@/components/landing/install-cta";
import { ProofStrip } from "@/components/landing/proof-strip";
import { SeeItWork } from "@/components/landing/see-it-work";
import { SpecsAndAttachments } from "@/components/landing/specs-and-attachments";
import { TuiAndCli } from "@/components/landing/tui-and-cli";
import { WatchLive } from "@/components/landing/watch-live";
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
      <ProofStrip />
      <SeeItWork />
      <HowItWorks />
      <WatchLive />
      <BringYourModels />
      <FilesInRepo />
      <TuiAndCli />
      <SpecsAndAttachments />
      <InstallCta />
    </>
  );
}
