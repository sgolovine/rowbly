// React and the React reconciler select their production or development bundle from `NODE_ENV` one time, when
// they are first loaded. Rowbly sets `NODE_ENV` only for that load, so that the processes and threads that it
// starts later do not inherit a value that Rowbly set.

/** Sets `NODE_ENV` of this process. It is the only place that writes the value. */
function writeNodeEnv(value: string | undefined): void {
  if (value === undefined) {
    // An assignment of `undefined` to `process.env` gives the string "undefined". Thus remove the key.
    delete process.env.NODE_ENV;

    return;
  }

  // biome-ignore lint/plugin: `process.env` is the Node API that gives the environment to child processes.
  process.env.NODE_ENV = value;
}

/**
 * Runs `load` with `NODE_ENV=production` when the user did not set `NODE_ENV`, so that React loads its production
 * bundles. After the load, `NODE_ENV` has its value from before again. A value of the user does not change.
 */
export async function loadInProductionMode<T>(load: () => Promise<T>): Promise<T> {
  const isSetByRowbly = process.env.NODE_ENV === undefined;

  if (!isSetByRowbly) {
    return load();
  }

  writeNodeEnv("production");

  try {
    return await load();
  } finally {
    writeNodeEnv(undefined);
  }
}
