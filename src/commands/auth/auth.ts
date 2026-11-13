import type { Command } from "commander";
import {
  type AuthInteraction,
  authRuntime,
  getAuthStatus,
  listProviders,
  loginProvider,
  logoutProvider,
} from "../../services/agent-auth/agent-auth.js";
import { ValidationError } from "../../services/errors/errors.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { createCliAuthInteraction } from "../auth-wizard/auth-wizard.js";
import { run } from "../output/output.js";

/** Login asks for secrets, so it runs only in a terminal, and not when the output is JSON. */
function requireTerminal(cmd: Command): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY || cmd.optsWithGlobals().json) {
    throw new ValidationError("Login needs an interactive terminal", {
      hint: "Run rowbly auth login in a terminal without --json.",
    });
  }
}

/** The login method from the flag, the only method of the provider, or the choice of the user. */
async function chooseMethod(
  interaction: AuthInteraction,
  methods: readonly string[],
  type: string | undefined,
): Promise<string | undefined> {
  if (type !== undefined) {
    return type;
  }

  return methods.length === 1
    ? methods[0]
    : interaction.prompt({
        type: "select",
        message: "Login method",
        options: methods.map((id) => ({ id, label: id })),
      });
}

async function login(
  cmd: Command,
  providerArg: string | undefined,
  opts: { type?: string },
  ctx: ServiceContext,
): Promise<Awaited<ReturnType<typeof loginProvider>>> {
  requireTerminal(cmd);

  const runtime = await authRuntime();
  const interaction = createCliAuthInteraction();
  const providers = await listProviders(runtime);
  const provider =
    providerArg ??
    (await interaction.prompt({
      type: "select",
      message: "Provider",
      options: providers.filter((p) => p.methods.length).map((p) => ({ id: p.id, label: p.id })),
    }));
  const methods = providers.find((p) => p.id === provider)?.methods;

  if (!methods?.length) {
    throw new ValidationError("Provider has no login method");
  }

  const type = await chooseMethod(interaction, methods, opts.type);

  if (type !== "oauth" && type !== "api_key") {
    throw new ValidationError("Use oauth or api_key");
  }

  return loginProvider(runtime, provider, type, interaction, ctx);
}

function registerProviders(program: Command): void {
  program
    .command("providers")
    .description("List provider login methods")
    .action((_opts: unknown, cmd: Command) =>
      run(
        cmd,
        async () => listProviders(await authRuntime()),
        (rows) => rows.map((p) => `${p.id}: ${p.methods.join(", ")}`).join("\n"),
      ),
    );
}

function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show configured providers without a health check")
    .action((_opts: unknown, cmd: Command) =>
      run(
        cmd,
        async () => getAuthStatus(await authRuntime()),
        (rows) =>
          rows.map((p) => `${p.id}: ${p.configured ? "configured" : "not configured"} (health unverified)`).join("\n"),
      ),
    );
}

function registerLogin(program: Command): void {
  program
    .command("login")
    .argument("[provider]")
    .option("--type <type>", "oauth or api_key")
    .description("Log in through a masked interactive prompt")
    .action((provider: string | undefined, opts: { type?: string }, cmd: Command) =>
      run(
        cmd,
        (ctx) => login(cmd, provider, opts, ctx),
        (result) => `Logged in: ${result.provider}`,
      ),
    );
}

function registerLogout(program: Command): void {
  program
    .command("logout")
    .argument("<provider>")
    .description("Remove a stored credential")
    .action((provider: string, _opts: unknown, cmd: Command) =>
      run(
        cmd,
        async () => logoutProvider(await authRuntime(), provider),
        (r) => `Logged out: ${r.provider}`,
      ),
    );
}

/** Registers the `rowbly auth` subcommands on the `auth` command. */
export function registerAuthCommands(program: Command): void {
  registerProviders(program);
  registerStatus(program);
  registerLogin(program);
  registerLogout(program);
}
