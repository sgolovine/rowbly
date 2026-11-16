import { ValidationError } from "../errors/errors.js";

/** The placement policies of the manager, in the order of the documentation. */
export const PLACEMENT_POLICIES = ["prefer-local", "most-free", "prefer-remote"] as const;

/** How the manager selects the machine of a new worker. */
export type PlacementPolicy = (typeof PLACEMENT_POLICIES)[number];

/** The policy of settings without a `placement` key. */
export const DEFAULT_PLACEMENT: PlacementPolicy = "prefer-local";

/** The placement value of `rowbly factory configure`. */
export interface PlacementInput {
  readonly placement?: string;
}

function isPolicy(value: unknown): value is PlacementPolicy {
  return PLACEMENT_POLICIES.some((policy) => policy === value);
}

/** Tells if a value is an absent `placement` key or a known policy. */
export function validPlacement(value: unknown): boolean {
  return value === undefined || isPolicy(value);
}

/** Gives the placement policy of the settings. An absent key gives the default policy. */
export function placementPolicy(settings: { readonly placement?: PlacementPolicy }): PlacementPolicy {
  return settings.placement ?? DEFAULT_PLACEMENT;
}

/**
 * Gives the `placement` key that the input sets, or no key without a placement value. An unknown policy gives a
 * `ValidationError`, so a call before the write stops the write.
 */
export function placementChange(input: PlacementInput): { readonly placement?: PlacementPolicy } {
  if (input.placement === undefined) {
    return {};
  }

  if (!isPolicy(input.placement)) {
    throw new ValidationError(`Use ${PLACEMENT_POLICIES.join(", ")} for --placement`, {
      details: { issues: [{ path: ["placement"], message: `must be one of ${PLACEMENT_POLICIES.join(", ")}` }] },
    });
  }

  return { placement: input.placement };
}
