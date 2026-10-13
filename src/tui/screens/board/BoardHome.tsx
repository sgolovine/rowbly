import { useContext, useEffect } from 'react';
import { UsageError } from '../../../core';
import { Loading } from '../../components';
import { ServicesContext, useAsync } from '../../hooks';
import { useRouter } from '../../router';
import type { ScreenComponent, ScreenProps } from '../types';

/** Wraps the home menu so that it opens the board view instead when a Board resolves from context. Without a Data Root it stays the home menu. */
export function withBoardHome(Home: ScreenComponent | undefined): ScreenComponent {
  function BoardHome(props: ScreenProps) {
    const { services } = useContext(ServicesContext);
    const router = useRouter();
    const resolved = useAsync(async () => {
      if (!services) return false;
      try {
        await services.context.resolveBoard();
        return true;
      } catch (err) {
        if (err instanceof UsageError) return false;
        throw err;
      }
    }, [services]);

    useEffect(() => {
      if (resolved.data) router.replace('board', {});
    }, [resolved.data, router]);

    if (resolved.data === false || resolved.error) return Home ? <Home {...props} /> : null;
    return <Loading />;
  }
  return BoardHome;
}
