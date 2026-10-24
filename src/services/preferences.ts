// The TUI's per-user preferences, kept in the Home Config (ADR-0031).
import { readHomeConfig, updateHomeConfig } from '../storage';

/** Whether the TUI opens a Story after creating it; off when the Home Config does not say. */
export async function readOpenStoryAfterCreation(home: string): Promise<boolean> {
  return (await readHomeConfig(home)).openStoryAfterCreation ?? false;
}

/** Turns opening a Story after creating it on or off in the Home Config, keeping its other keys. */
export async function setOpenStoryAfterCreation(home: string, on: boolean): Promise<boolean> {
  const saved = await updateHomeConfig(home, (config) => ({ ...config, openStoryAfterCreation: on }));
  return saved.openStoryAfterCreation ?? false;
}
