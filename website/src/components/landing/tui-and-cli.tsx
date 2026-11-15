import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The commands and their output, from a real run of Rowbly 0.17.0 in a new demo Project. */
const CLI_RUNS = [
  {
    command: 'rowbly story create --title "Add an undo button for two-player games"',
    output: "Created TTT-01 in BACKLOG",
  },
  {
    command: "rowbly factory status",
    output: '{\n  "version": 1,\n  "phase": "stopped"\n}',
  },
] as const;

const inlineCodeClass = "font-mono text-brand-text";

/** The "Humans and scripts" section of the landing page. Tabs show the TUI and the CLI. */
export function TuiAndCli() {
  return (
    <Section
      id="tui-and-cli"
      headline="A terminal UI when you want to look. A CLI when you want to script."
      subhead={
        <>
          Open <code className={inlineCodeClass}>rowbly</code> and work the board with your keyboard. Or drive it from
          the command line: <code className={inlineCodeClass}>rowbly story create</code>,{" "}
          <code className={inlineCodeClass}>rowbly factory status</code>. Your own scripts and agents can use the same
          commands.
        </>
      }
    >
      <Tabs defaultValue="tui">
        <TabsList>
          <TabsTrigger value="tui" className="px-4">
            TUI
          </TabsTrigger>
          <TabsTrigger value="cli" className="px-4">
            CLI
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tui" className="mt-2">
          <TerminalFrame>
            <img
              src="/images/board.webp"
              alt="The Rowbly terminal UI: a board of Stories in Stage columns, each one with its agent."
              width={1351}
              height={618}
              loading="lazy"
            />
          </TerminalFrame>
        </TabsContent>
        <TabsContent value="cli" className="mt-2">
          <TerminalFrame>
            <div className="overflow-x-auto p-4 font-mono text-sm">
              {CLI_RUNS.map((run) => (
                <div key={run.command} className="mb-4 last:mb-0">
                  <p className="whitespace-pre text-brand-text">
                    <span aria-hidden="true" className="mr-2 text-brand-muted select-none">
                      $
                    </span>
                    {run.command}
                  </p>
                  <pre className="mt-1 text-brand-muted">{run.output}</pre>
                </div>
              ))}
            </div>
          </TerminalFrame>
        </TabsContent>
      </Tabs>
    </Section>
  );
}
