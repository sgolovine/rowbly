import { useEffect, useState } from 'react';
import type { PluginContext, Services } from '../../services';
import { useServices } from './useServices';

/** Only mounted Plugin screens receive a lease; render helpers keep their ordinary context. */
export function usePluginScreenContext(id: string | undefined): PluginContext | null {
  const services = useServices();
  const [loaded, setLoaded] = useState<{ services: Services; id: string; context: PluginContext } | null>(null);
  useEffect(() => {
    if (id === undefined) return;
    const lease = new AbortController();
    try {
      setLoaded({ services, id, context: services.plugins.screenContext(id, lease.signal) });
    } catch {
      setLoaded(null);
    }
    return () => lease.abort();
  }, [services, id]);
  return loaded?.services === services && loaded.id === id ? loaded.context : null;
}
