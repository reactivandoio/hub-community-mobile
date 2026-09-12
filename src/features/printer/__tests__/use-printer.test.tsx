import { act, renderHook } from '@testing-library/react-native';
import { MemoryStorage } from '@/features/checkin/store';
import type { UsbPrinterDevice } from '../../../../modules/tspl-usb-printer';
import { usePrinter } from '../use-printer';

const mockListDevices = jest.fn<UsbPrinterDevice[], []>();
const mockRequestPermission = jest.fn<Promise<boolean>, [string]>();
jest.mock('../../../../modules/tspl-usb-printer', () => ({
  isAvailable: true,
  listDevices: () => mockListDevices(),
  requestPermission: (deviceName: string) => mockRequestPermission(deviceName),
  printBitmap: async () => {},
}));

const device = (deviceName: string, hasPermission: boolean): UsbPrinterDevice => ({
  deviceName,
  vendorId: 1,
  productId: 2,
  productName: '4BARCODE',
  manufacturerName: null,
  hasPermission,
});

const poll = async () => {
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockListDevices.mockReset();
  mockRequestPermission.mockReset().mockResolvedValue(false);
});
afterEach(() => jest.useRealTimers());

describe('usePrinter', () => {
  it('asks for USB permission once per attached device and reports permissionDenied meanwhile', async () => {
    mockListDevices.mockReturnValue([device('/dev/p1', false)]);
    const { result } = await renderHook(() => usePrinter(new MemoryStorage()));
    await act(async () => {});
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockRequestPermission).toHaveBeenCalledWith('/dev/p1');
    expect(result.current).toMatchObject({ ready: false, permissionDenied: true });

    await poll();
    await poll();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('becomes ready once the permission is granted', async () => {
    mockListDevices.mockReturnValue([device('/dev/p1', false)]);
    mockRequestPermission.mockImplementation(async () => {
      mockListDevices.mockReturnValue([device('/dev/p1', true)]);
      return true;
    });
    const { result } = await renderHook(() => usePrinter(new MemoryStorage()));
    await act(async () => {});
    expect(result.current).toMatchObject({ ready: true, permissionDenied: false });
  });

  it('asks again after the device is unplugged and plugged back in', async () => {
    mockListDevices.mockReturnValue([device('/dev/p1', false)]);
    const { result } = await renderHook(() => usePrinter(new MemoryStorage()));
    await act(async () => {});
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);

    mockListDevices.mockReturnValue([]);
    await poll();
    expect(result.current).toMatchObject({ selected: null, permissionDenied: false });

    mockListDevices.mockReturnValue([device('/dev/p2', false)]);
    await poll();
    expect(mockRequestPermission).toHaveBeenCalledTimes(2);
    expect(mockRequestPermission).toHaveBeenLastCalledWith('/dev/p2');
  });

  it('keeps the same devices array while the USB list content is unchanged', async () => {
    mockListDevices.mockReturnValue([device('/dev/p1', true)]);
    const { result } = await renderHook(() => usePrinter(new MemoryStorage()));
    const first = result.current.devices;
    mockListDevices.mockReturnValue([device('/dev/p1', true)]);
    await poll();
    expect(result.current.devices).toBe(first);
    mockListDevices.mockReturnValue([device('/dev/p1', false)]);
    await poll();
    expect(result.current.devices).not.toBe(first);
  });
});
