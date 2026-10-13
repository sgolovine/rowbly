import type { ScreenRegistry } from '../types';
import { CommentFormScreen } from './CommentFormScreen';

// The list itself (`CommentsPanel`) is embedded in the Story and Task detail views.
export const commentsScreens: ScreenRegistry = {
  'comment-form': CommentFormScreen,
};
