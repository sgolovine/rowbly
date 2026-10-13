import type { ScreenRegistry } from '../types';
import { BoardScreen } from './BoardScreen';

export { withBoardHome } from './BoardHome';

export const boardScreens: ScreenRegistry = {
  board: BoardScreen,
};
