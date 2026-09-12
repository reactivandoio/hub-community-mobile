import { useApolloClient } from '@apollo/client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createApolloTransport } from './apollo-transport';
import { createNetInfoConnectivity } from './netinfo-adapter';
import { useCheckinStore } from './store-provider';
import { SyncEngine, type SyncStatus } from './sync';

let sharedConnectivity: ReturnType<typeof createNetInfoConnectivity> | null = null;

/** Runs a SyncEngine for `slug` while the calling screen is mounted. */
export function useEventSync(slug: string, engineOverride?: SyncEngine): SyncStatus & { syncNow: () => Promise<void> } {
  const store = useCheckinStore();
  const client = useApolloClient();
  const engine = useMemo(() => {
    if (engineOverride) return engineOverride;
    sharedConnectivity ??= createNetInfoConnectivity();
    return new SyncEngine({ store, transport: createApolloTransport(client), connectivity: sharedConnectivity });
  }, [engineOverride, store, client]);

  useEffect(() => {
    engine.start(slug);
    return () => engine.stop();
  }, [engine, slug]);

  const status = useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getStatus(),
  );
  return { ...status, syncNow: () => engine.syncNow() };
}
