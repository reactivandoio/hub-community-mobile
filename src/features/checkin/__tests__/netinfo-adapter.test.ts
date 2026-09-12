import { createNetInfoConnectivity } from '../netinfo-adapter';

type Listener = (state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void;
let emit: Listener = () => {};
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: (cb: Listener) => {
    emit = cb;
    return () => {};
  },
}));

describe('createNetInfoConnectivity', () => {
  it('follows isConnected only, ignoring isInternetReachable (restricted venue networks)', () => {
    const connectivity = createNetInfoConnectivity();
    const seen: boolean[] = [];
    connectivity.subscribe((online) => seen.push(online));

    emit({ isConnected: true, isInternetReachable: false });
    expect(connectivity.isOnline()).toBe(true);
    emit({ isConnected: false, isInternetReachable: null });
    expect(connectivity.isOnline()).toBe(false);
    emit({ isConnected: true, isInternetReachable: null });
    expect(connectivity.isOnline()).toBe(true);
    expect(seen).toEqual([false, true]);
  });
});
