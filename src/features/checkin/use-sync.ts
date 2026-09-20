import { useApolloClient } from '@apollo/client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createApolloTransport } from './apollo-transport';
import { createNetInfoConnectivity } from './netinfo-adapter';
import { useCheckinStore } from './store-provider';
import { SyncEngine, type SyncStatus } from './sync';

let sharedConnectivity: ReturnType<typeof createNetInfoConnectivity> | null = null;

interface Options {
  /** Overrides the engine's default pull interval (the kiosk polls faster). */
  pullIntervalMs?: number;
}

/** Runs a SyncEngine for `slug` while the calling screen is mounted. */
export function useEventSync(slug: string, engineOverride?: SyncEngine, { pullIntervalMs }: Options = {}): SyncStatus & { syncNow: () => Promise<void> } {
  const store = useCheckinStore();
  const client = useApolloClient();
  const engine = useMemo(() => {
    if (engineOverride) return engineOverride;
    sharedConnectivity ??= createNetInfoConnectivity();
    return new SyncEngine({ store, transport: createApolloTransport(client), connectivity: sharedConnectivity, pullIntervalMs });
  }, [engineOverride, store, client, pullIntervalMs]);

  useEffect(() => {
    engine.start(slug);
    return () => engine.stop();
  }, [engine, slug]);

  const status = useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getStatus(),
  );
  // The manual button forces the run even when NetInfo says offline (#6).
  return { ...status, syncNow: () => engine.syncNow({ force: true }) };
}
