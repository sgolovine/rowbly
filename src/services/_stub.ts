/** Thrown by every service method until its owning work package implements it. */
export function notImplemented(workPackage: string): never {
  throw new Error(`not implemented: ${workPackage}`);
}
