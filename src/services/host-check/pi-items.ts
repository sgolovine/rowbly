import { z } from "zod";
import { remoteRowblyPath } from "../host-install/host-install.js";
import type { RemoteCommand } from "../host-transport/host-transport.js";
import {
  type CheckEnv,
  type CheckItem,
  failureText,
  item,
  runRemote,
  skipped,
  stdoutText,
  transportFailure,
} from "./check-item.js";

/** The `--json auth status` output of the remote Rowbly. */
const AUTH_STATUS = z.array(z.object({ id: z.string(), configured: z.boolean() }));

/** The `--json model list` output of the remote Rowbly. */
const MODEL_LIST = z.array(z.object({ provider: z.string(), modelId: z.string() }));

/** The result of a remote Rowbly command with JSON output: the value, or the problem as text. */
type JsonOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly item: CheckItem; readonly problem: string };

type PiItemId = "pi-login" | "models";

/** The remote Rowbly command with `--json`. These commands load Pi on the host only. */
function rowblyCommand(env: Pick<CheckEnv, "build">, ...args: string[]): RemoteCommand {
  return [remoteRowblyPath(env.build.id), "--json", ...args];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Runs a remote Rowbly command and reads its JSON with the schema. Bad JSON is a `fail` item, not a throw. */
async function remoteJson<T>(
  env: CheckEnv,
  id: PiItemId,
  command: RemoteCommand,
  schema: z.ZodType<T>,
): Promise<JsonOutcome<T>> {
  const outcome = await runRemote(env, command);

  if (!outcome.ok) {
    return { ok: false, item: transportFailure(env, id, outcome.error), problem: outcome.error.message };
  }

  const { result } = outcome;
  const text = stdoutText(result);
  const parsed = schema.safeParse(parseJson(text));

  if (result.exitCode !== 0 || !parsed.success) {
    const problem =
      result.exitCode === 0
        ? `${command.slice(1).join(" ")} gives bad JSON: ${text.slice(0, 200)}`
        : failureText(result);
    const action = `Run ${command.join(" ")} on the host and repair the problem.`;

    return { ok: false, item: item(id, "fail", problem, action), problem };
  }

  return { ok: true, value: parsed.data };
}

/** The configured Pi providers of the host, or the problem as text. */
export async function hostProviders(
  env: CheckEnv,
): Promise<{ readonly providers: readonly string[] } | { readonly item: CheckItem; readonly problem: string }> {
  const outcome = await remoteJson(env, "pi-login", rowblyCommand(env, "auth", "status"), AUTH_STATUS);

  if (!outcome.ok) {
    return { item: outcome.item, problem: outcome.problem };
  }

  return { providers: outcome.value.filter((provider) => provider.configured).map((provider) => provider.id) };
}

/** The `pi-login` item: Pi has at least one configured provider on the host. */
export async function piLoginItem(env: CheckEnv): Promise<CheckItem> {
  const found = await hostProviders(env);

  if ("item" in found) {
    return found.item;
  }

  return found.providers.length === 0
    ? item("pi-login", "fail", "Pi has no configured provider on the host", `Run rowbly host login ${env.hostId}.`)
    : item("pi-login", "ok", found.providers.join(", "));
}

function modelKey(model: { readonly provider: string; readonly modelId: string }): string {
  return `${model.provider}/${model.modelId}`;
}

/** The `models` item: each worker model of the Project is in the model list of the host. */
export async function modelsItem(env: CheckEnv): Promise<CheckItem> {
  if (!env.project) {
    return skipped("models", "Not in a Rowbly Project.");
  }

  if (env.project.models.length === 0) {
    return item(
      "models",
      "warning",
      "The factory settings have no worker model. The host uses its default Pi model.",
      "Set a worker model in the factory settings of the Project.",
    );
  }

  const outcome = await remoteJson(env, "models", rowblyCommand(env, "model", "list"), MODEL_LIST);

  if (!outcome.ok) {
    return outcome.item;
  }

  const available = new Set(outcome.value.map(modelKey));
  const wanted = env.project.models.map(modelKey);
  const missing = wanted.filter((key) => !available.has(key));

  return missing.length === 0
    ? item("models", "ok", wanted.join(", "))
    : item(
        "models",
        "fail",
        `The host does not have ${missing.join(", ")}`,
        `Run rowbly host login ${env.hostId} and log in to the provider of each missing model.`,
      );
}
