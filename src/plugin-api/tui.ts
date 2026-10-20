// The TUI part of the Plugin API: the Ink, React and Rowbly pieces a Plugin's screens, tabs and
// sections are built from. Only a Plugin's TUI part imports it, so command mode never loads it.
export type { Key } from 'ink';
export { Box, Text, useInput } from 'ink';
export type { ReactNode } from 'react';
export { useCallback, useEffect, useMemo, useRef, useState } from 'react';
export type {
  DetailRow,
  EditorMode,
  FormField,
  FormValue,
  FormValues,
  FullScreenEditorControl,
  FullScreenEditorOptions,
  SelectItem,
} from '../tui/components';
export {
  ConfirmDialog,
  DetailView,
  Form,
  Loading,
  MarkdownView,
  markdownToPlain,
  SelectList,
  StageBadge,
  Tabs,
  TextArea,
  TextInput,
  useFullScreenEditor,
} from '../tui/components';
export type { AsyncState } from '../tui/hooks';
export {
  useAsync,
  useDirty,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useLayout,
  useReloadOnReturn,
} from '../tui/hooks';
// Not `useToast`: a Plugin shows messages through `ui.toast` and `ui.error` (`PluginUi`), the one
// supported way, which also attributes errors (CQ-51).
export type { KeyHint } from '../tui/keymap';
export { FORM_KEYS, moveDelta } from '../tui/keymap';
