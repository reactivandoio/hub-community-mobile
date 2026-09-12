import NetInfo from '@react-native-community/netinfo';
import type { Connectivity } from './sync';

const reachable = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) =>
  Boolean(state.isConnected) && state.isInternetReachable !== false;

/** Connectivity backed by NetInfo. Seeds `isOnline` optimistically until the first event. */
export function createNetInfoConnectivity(): Connectivity {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();
  NetInfo.addEventListener((state) => {
    const next = reachable(state);
    if (next === online) return;
    online = next;
    listeners.forEach((l) => l(online));
  });
  return {
    isOnline: () => online,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
