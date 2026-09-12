import type { KeyValueStorage } from '@/features/checkin/store';
import type { UsbPrinterDevice } from '../../../modules/tspl-usb-printer';

export interface PrinterPrefs {
  vendorId: number;
  productId: number;
}
export interface LabelPrefs {
  gapMm: number;
  density: number;
}
export const DEFAULT_LABEL: LabelPrefs = { gapMm: 3, density: 8 };

const PRINTER_KEY = 'printer:selected';
const LABEL_KEY = 'printer:label';

export const readPrinterPrefs = (s: KeyValueStorage): PrinterPrefs | null => {
  const raw = s.getString(PRINTER_KEY);
  return raw ? (JSON.parse(raw) as PrinterPrefs) : null;
};
export const writePrinterPrefs = (s: KeyValueStorage, prefs: PrinterPrefs | null) =>
  prefs ? s.set(PRINTER_KEY, JSON.stringify(prefs)) : s.delete(PRINTER_KEY);

export const readLabelPrefs = (s: KeyValueStorage): LabelPrefs => {
  const raw = s.getString(LABEL_KEY);
  return raw ? { ...DEFAULT_LABEL, ...(JSON.parse(raw) as Partial<LabelPrefs>) } : DEFAULT_LABEL;
};
export const writeLabelPrefs = (s: KeyValueStorage, prefs: LabelPrefs) => s.set(LABEL_KEY, JSON.stringify(prefs));

/** The remembered printer when plugged in; otherwise the only device; otherwise nothing. */
export function pickDevice(devices: UsbPrinterDevice[], prefs: PrinterPrefs | null): UsbPrinterDevice | null {
  const remembered = prefs && devices.find((d) => d.vendorId === prefs.vendorId && d.productId === prefs.productId);
  if (remembered) return remembered;
  return devices.length === 1 ? devices[0] : null;
}
