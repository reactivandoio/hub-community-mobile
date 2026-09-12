// USB (OTG) transport for TSPL label printers such as the 4BARCODE 4B-2074A.
// Android only; on other platforms the module is absent and `isAvailable` is false.
import { requireOptionalNativeModule } from 'expo';

export interface UsbPrinterDevice {
  deviceName: string;
  vendorId: number;
  productId: number;
  productName: string | null;
  manufacturerName: string | null;
  hasPermission: boolean;
}

export interface LabelOptions {
  widthMm?: number;
  heightMm?: number;
  gapMm?: number;
  dpi?: number;
  density?: number;
  direction?: number;
  threshold?: number;
}

interface NativeModule {
  listDevices(): UsbPrinterDevice[];
  requestPermission(deviceName: string): Promise<boolean>;
  printRaw(deviceName: string, base64: string): Promise<void>;
  printBitmap(deviceName: string, pngBase64: string, options: LabelOptions): Promise<void>;
}

const native = requireOptionalNativeModule<NativeModule>('TsplUsbPrinter');

export const isAvailable = native != null;

const mod = (): NativeModule => {
  if (!native) throw new Error('TsplUsbPrinter is only available on Android');
  return native;
};

export const listDevices = (): UsbPrinterDevice[] => mod().listDevices();
export const requestPermission = (deviceName: string) => mod().requestPermission(deviceName);
export const printRaw = (deviceName: string, base64: string) => mod().printRaw(deviceName, base64);
export const printBitmap = (deviceName: string, pngBase64: string, options: LabelOptions = {}) =>
  mod().printBitmap(deviceName, pngBase64, options);
