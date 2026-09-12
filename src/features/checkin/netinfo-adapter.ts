import NetInfo from '@react-native-community/netinfo';
import type { Connectivity } from './sync';

// Only `isConnected` counts. NetInfo's `isInternetReachable` probe can stay
// false on restricted venue networks (captive portal accepted, egress only to
// a few hosts) even though the BFF is reachable; gating on it would wedge the
// sync. If the BFF really is unreachable the request fails into NetworkError
// and is retried anyway.
const reachable = (state: { isConnected: boolean | null }) => Boolean(state.isConnected);

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
