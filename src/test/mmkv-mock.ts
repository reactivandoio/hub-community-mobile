// react-native-mmkv 4 is a Nitro (native) module and never loads under Jest.
// This mock stands in for it via `moduleNameMapper`, mirroring the small
// slice of the real `createMMKV` factory API this app uses.
export interface MMKV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): boolean;
}

export function createMMKV(): MMKV {
  const m = new Map<string, string>();
  return {
    getString: (k) => m.get(k),
    set: (k, v) => {
      m.set(k, v);
    },
    remove: (k) => m.delete(k),
  };
}
