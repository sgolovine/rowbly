import type { ScreenProps } from '../types';
import { EpicDetail } from './EpicDetail';
import { EpicForm } from './EpicForm';
import { EpicList } from './EpicList';

/** The Epics of the current Workspace, or of `params.workspaceId` without changing the context. */
export function EpicsScreen({ params }: ScreenProps) {
  const id = typeof params.id === 'string' ? params.id : undefined;
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined;
  if (params.view === 'form') return <EpicForm id={id} workspaceId={workspaceId} />;
  if (params.view === 'detail' && id) return <EpicDetail id={id} workspaceId={workspaceId} />;
  return <EpicList workspaceId={workspaceId} />;
}
