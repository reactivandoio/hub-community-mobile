import { MemoryStorage } from '@/features/checkin/store';
import { DEFAULT_LABEL, pickDevice, readLabelPrefs, readPrinterPrefs, writeLabelPrefs, writePrinterPrefs } from '../printer-prefs';
import type { UsbPrinterDevice } from '../../../../modules/tspl-usb-printer';

const dev = (vendorId: number, productId: number, deviceName = `/dev/${vendorId}`): UsbPrinterDevice => ({
  deviceName, vendorId, productId, productName: null, manufacturerName: null, hasPermission: false,
});

describe('printer prefs', () => {
  it('round-trips the selected printer and label settings', () => {
    const s = new MemoryStorage();
    expect(readPrinterPrefs(s)).toBeNull();
    expect(readLabelPrefs(s)).toEqual(DEFAULT_LABEL);
    writePrinterPrefs(s, { vendorId: 1, productId: 2 });
    writeLabelPrefs(s, { gapMm: 2, density: 10 });
    expect(readPrinterPrefs(s)).toEqual({ vendorId: 1, productId: 2 });
    expect(readLabelPrefs(s)).toEqual({ gapMm: 2, density: 10 });
    writePrinterPrefs(s, null);
    expect(readPrinterPrefs(s)).toBeNull();
  });
});

describe('pickDevice', () => {
  it('prefers the remembered printer, else the only device, else null', () => {
    expect(pickDevice([dev(1, 1), dev(2, 2)], { vendorId: 2, productId: 2 })?.vendorId).toBe(2);
    expect(pickDevice([dev(1, 1)], null)?.vendorId).toBe(1);
    expect(pickDevice([dev(1, 1), dev(2, 2)], null)).toBeNull();
    expect(pickDevice([], { vendorId: 2, productId: 2 })).toBeNull();
  });
});
