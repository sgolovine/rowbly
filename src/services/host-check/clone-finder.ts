import { ValidationError } from "../errors/errors.js";
import { cloneStatus } from "../host-project/host-clone.js";
import { hostProjectFor } from "../host-project/host-project.js";
import { localOrigin } from "../host-project/local-origin.js";
import type { ServiceContext } from "../workspace/workspace.js";
import type { CloneFinder } from "./check-item.js";

/**
 * The clone finder of `rowbly host use`. It gives the path of the clone of the current Project, or `undefined` when
 * the host does not use the Project or the clone is missing. A folder that is not a clone of `origin` gives
 * `VALIDATION`, so that the `clone` item tells the user what is wrong.
 */
export function hostCloneFinder(ctx: ServiceContext): CloneFinder {
  return async (transport, hostId, root) => {
    const record = await hostProjectFor(hostId, ctx);

    if (!record) {
      return undefined;
    }

    const status = await cloneStatus(transport, record, await localOrigin(root));

    if (status.state === "ok" || status.state === "missing") {
      return status.state === "ok" ? status.path : undefined;
    }

    const problem = status.state === "not-a-repository" ? "is not a Git clone" : `has the origin ${status.origin}`;

    throw new ValidationError(`The folder ${status.path} on the host ${problem}.`, {
      details: { ...status },
      hint: `Run rowbly host unuse ${hostId}, then rowbly host use ${hostId}.`,
    });
  };
}
