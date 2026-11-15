/** The intro of the "How it works" page. It has the only `<h1>` of the page. */
export function Intro() {
  return (
    <section className="px-4 pt-8 pb-4 sm:px-6 md:pt-16 md:pb-8">
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 font-mono text-sm text-brand-muted">How it works</p>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-balance text-brand-text md:text-4xl lg:text-5xl">
          Rowbly turns a Kanban board into a production line. Each column is a Stage. Each Stage has a prompt. Agents do
          what the prompt says.
        </h1>
        <p className="mt-5 max-w-3xl text-base text-brand-muted md:text-lg">
          This page gives you the full picture before you install: the board, the prompts, the factory, the controls
          that keep you in charge, your models and the files in your repo.
        </p>
      </div>
    </section>
  );
}
