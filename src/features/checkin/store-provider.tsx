import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createMMKV } from 'react-native-mmkv';
import { CheckinStore, type KeyValueStorage, type LoadedEventSummary } from './store';
import type { EventCache } from './types';

// react-native-mmkv 4 (Nitro) exposes `MMKV` only as a type; instances come
// from the `createMMKV` factory, and key removal is `.remove`, not `.delete`.
const mmkvStorage = (): KeyValueStorage => {
  const mmkv = createMMKV({ id: 'checkin' });
  return {
    getString: (k) => mmkv.getString(k),
    set: (k, v) => mmkv.set(k, v),
    delete: (k) => {
      mmkv.remove(k);
    },
  };
};

export const createMmkvStore = () => new CheckinStore({ storage: mmkvStorage() });

const Ctx = createContext<CheckinStore | null>(null);

export function CheckinStoreProvider({ store, children }: { store?: CheckinStore; children: ReactNode }) {
  const value = useMemo(() => store ?? createMmkvStore(), [store]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCheckinStore(): CheckinStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('useCheckinStore fora de CheckinStoreProvider');
  return store;
}

export function useEventCache(slug: string): EventCache | undefined {
  const store = useCheckinStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getEvent(slug),
  );
}

export function useLoadedEvents(): LoadedEventSummary[] {
  const store = useCheckinStore();
  // listEvents() builds a new array on every call; useSyncExternalStore needs
  // a referentially stable snapshot when nothing changed, or it loops
  // ("Maximum update depth exceeded"). A ref (not a useMemo-closed variable,
  // which the react-hooks/immutability lint rule rejects as a render-purity
  // violation) holds the last snapshot keyed by its JSON content, and by the
  // store instance so a swapped store can't collide with a stale cache.
  const cacheRef = useRef<{ store: CheckinStore; key: string; value: LoadedEventSummary[] } | null>(null);
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => {
      const next = store.listEvents();
      const nextKey = JSON.stringify(next);
      const cache = cacheRef.current;
      if (cache && cache.store === store && cache.key === nextKey) return cache.value;
      cacheRef.current = { store, key: nextKey, value: next };
      return next;
    },
  );
}
