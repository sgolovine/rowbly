import { createFileRoute } from "@tanstack/react-router";
import { BringYourModels } from "@/components/landing/bring-your-models";
import { FilesInRepo } from "@/components/landing/files-in-repo";
import { Hero } from "@/components/landing/hero";
import { InstallCta } from "@/components/landing/install-cta";
import { ProofStrip } from "@/components/landing/proof-strip";
import { SeeItWork } from "@/components/landing/see-it-work";
import { SpecsAndAttachments } from "@/components/landing/specs-and-attachments";
import { TuiAndCli } from "@/components/landing/tui-and-cli";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <SeeItWork />
      <BringYourModels />
      <FilesInRepo />
      <TuiAndCli />
      <SpecsAndAttachments />
      <InstallCta />
    </>
  );
}
