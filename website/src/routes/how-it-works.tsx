import { createFileRoute } from "@tanstack/react-router";
import { FilesInYourRepo } from "@/components/how-it-works/files-in-your-repo";
import { GetStarted } from "@/components/how-it-works/get-started";
import { Intro } from "@/components/how-it-works/intro";
import { StagePrompts } from "@/components/how-it-works/stage-prompts";
import { StayingInControl } from "@/components/how-it-works/staying-in-control";
import { TheBoard } from "@/components/how-it-works/the-board";
import { TheFactory } from "@/components/how-it-works/the-factory";
import { YourModels } from "@/components/how-it-works/your-models";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/how-it-works")({
  head: () =>
    pageHead({
      path: "/how-it-works",
      title: "How it works | Rowbly",
      description:
        "How Rowbly works: a Kanban board of Stories in your repo, a plain-English prompt for each Stage, and a factory of AI agents that does the work while you watch.",
    }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  return (
    <>
      <Intro />
      <TheBoard />
      <StagePrompts />
      <TheFactory />
      <StayingInControl />
      <YourModels />
      <FilesInYourRepo />
      <GetStarted />
    </>
  );
}
