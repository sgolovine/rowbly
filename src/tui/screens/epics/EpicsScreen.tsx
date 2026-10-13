import type { ScreenProps } from '../types';
import { EpicDetail } from './EpicDetail';
import { EpicForm } from './EpicForm';
import { EpicList } from './EpicList';

/** The Epics: the list, `detail` for Epic `params.id`, or the create / edit `form`. */
export function EpicsScreen({ params }: ScreenProps) {
  const id = typeof params.id === 'string' ? params.id : undefined;
  if (params.view === 'form') return <EpicForm id={id} />;
  if (params.view === 'detail' && id) return <EpicDetail id={id} />;
  return <EpicList />;
}
