import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMMKV } from 'react-native-mmkv';
import type { KeyValueStorage } from '@/features/checkin/store';
import * as Printer from '../../../modules/tspl-usb-printer';
import type { UsbPrinterDevice } from '../../../modules/tspl-usb-printer';
import { pickDevice, readPrinterPrefs, writePrinterPrefs } from './printer-prefs';

let printerStorage: KeyValueStorage | null = null;

// react-native-mmkv 4 (Nitro) exposes `MMKV` only as a type; instances come
// from the `createMMKV` factory, and key removal is `.remove`, not `.delete`
// (same pattern as `src/features/checkin/store-provider.tsx`).
export const getPrinterStorage = (): KeyValueStorage => {
  if (!printerStorage) {
    const mmkv = createMMKV({ id: 'printer' });
    printerStorage = {
      getString: (k) => mmkv.getString(k),
      set: (k, v) => mmkv.set(k, v),
      delete: (k) => {
        mmkv.remove(k);
      },
    };
  }
  return printerStorage;
};

export interface PrinterState {
  available: boolean;
  devices: UsbPrinterDevice[];
  selected: UsbPrinterDevice | null;
  ready: boolean;
  /** A printer is attached but Android has not granted USB permission for it (yet). */
  permissionDenied: boolean;
  refresh(): void;
  select(device: UsbPrinterDevice): Promise<boolean>;
}

const sameDevices = (a: UsbPrinterDevice[], b: UsbPrinterDevice[]) =>
  a.length === b.length && a.every((d, i) => d.deviceName === b[i].deviceName && d.hasPermission === b[i].hasPermission);

/** USB printer discovery + the remembered selection. Polls the device list every 3 s (USB attach/detach). */
export function usePrinter(storage?: KeyValueStorage): PrinterState {
  const store = useMemo(() => storage ?? getPrinterStorage(), [storage]);
  const [devices, setDevices] = useState<UsbPrinterDevice[]>(() => (Printer.isAvailable ? Printer.listDevices() : []));
  const [prefs, setPrefs] = useState(() => readPrinterPrefs(store));

  const refresh = useCallback(() => {
    if (!Printer.isAvailable) return;
    const next = Printer.listDevices();
    // Keep the previous array when nothing changed so the 3 s poll does not
    // re-render every consumer.
    setDevices((prev) => (sameDevices(prev, next) ? prev : next));
  }, []);

  // The initial list comes from the lazy `useState` initializer above; this
  // effect only owns the recurring poll (USB attach/detach isn't observable
  // any other way), which keeps it free of a synchronous setState-in-effect.
  useEffect(() => {
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const select = useCallback(
    async (device: UsbPrinterDevice) => {
      const granted = await Printer.requestPermission(device.deviceName);
      if (granted) {
        const next = { vendorId: device.vendorId, productId: device.productId };
        writePrinterPrefs(store, next);
        setPrefs(next);
      }
      refresh();
      return granted;
    },
    [store, refresh],
  );

  const selected = pickDevice(devices, prefs);
  const selectedName = selected?.deviceName ?? null;
  const selectedPermitted = Boolean(selected?.hasPermission);

  // Android drops the USB permission on every replug, so ask again — once per
  // attach (keyed by deviceName; reset when the device disappears). The
  // system dialog resolves asynchronously; a refresh afterwards picks up the
  // new `hasPermission`. An explicit `select()` in the meantime supersedes
  // this request on the native side, which rejects it — ignored here.
  const requestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedName) {
      requestedFor.current = null;
      return;
    }
    if (selectedPermitted || requestedFor.current === selectedName) return;
    requestedFor.current = selectedName;
    Printer.requestPermission(selectedName).then(
      (granted) => {
        if (granted) refresh();
      },
      () => {},
    );
  }, [selectedName, selectedPermitted, refresh]);

  return {
    available: Printer.isAvailable,
    devices,
    selected,
    ready: selectedPermitted,
    permissionDenied: selected != null && !selectedPermitted,
    refresh,
    select,
  };
}
