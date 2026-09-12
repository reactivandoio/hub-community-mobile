import { useCallback, useEffect, useMemo, useState } from 'react';
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
  refresh(): void;
  select(device: UsbPrinterDevice): Promise<boolean>;
}

/** USB printer discovery + the remembered selection. Polls the device list every 3 s (USB attach/detach). */
export function usePrinter(storage?: KeyValueStorage): PrinterState {
  const store = useMemo(() => storage ?? getPrinterStorage(), [storage]);
  const [devices, setDevices] = useState<UsbPrinterDevice[]>(() => (Printer.isAvailable ? Printer.listDevices() : []));
  const [prefs, setPrefs] = useState(() => readPrinterPrefs(store));

  const refresh = useCallback(() => {
    if (!Printer.isAvailable) return;
    setDevices(Printer.listDevices());
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
  return {
    available: Printer.isAvailable,
    devices,
    selected,
    ready: Boolean(selected?.hasPermission),
    refresh,
    select,
  };
}
