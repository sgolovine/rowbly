import type { ScreenRegistry } from '../types';
import { EpicsScreen } from './EpicsScreen';

/** One `epics` entry: `{}` lists Epics, `{ view: 'detail', id }` shows one, `{ view: 'form', id? }` creates or edits. */
export const epicsScreens: ScreenRegistry = {
  epics: EpicsScreen,
};
