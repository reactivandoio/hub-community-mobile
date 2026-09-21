import { requireOptionalNativeModule } from 'expo';

/**
 * The totem's own scanner, reached through the vendor service rather than
 * CameraX (see the module's Kotlin for why). Absent on a phone, hence optional.
 *
 * There is no preview: the reader is a fixed spot below the screen, not a
 * camera the person aims, so the kiosk just tells them where to hold the code.
 */
interface TopwiseScanner {
  isAvailable(): boolean;
  startDecode(): Promise<void>;
  stopDecode(): Promise<void>;
  addListener(event: 'onScanned', listener: (payload: { payload: string }) => void): { remove(): void };
}

const native = requireOptionalNativeModule<TopwiseScanner>('TopwiseScanner');

export const isAvailable = (): boolean => native?.isAvailable() ?? false;

export const startDecode = async (): Promise<void> => {
  await native?.startDecode();
};

/** Always call this when leaving: an unfinished session makes later reads come up black. */
export const stopDecode = async (): Promise<void> => {
  await native?.stopDecode();
};

export const onScanned = (listener: (payload: string) => void): { remove(): void } | null =>
  native?.addListener('onScanned', ({ payload }) => listener(payload)) ?? null;
