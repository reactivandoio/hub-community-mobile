import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * The totem's own scanner, reached through the vendor service rather than
 * CameraX (see the module's Kotlin for why). Absent on a phone, hence optional.
 */
interface TopwiseScanner {
  /** Whether this device ships the vendor scanner service at all. */
  isAvailable(): boolean;
  /** Hands the screen to the vendor's full-screen reader; null when cancelled or timed out. */
  scan(cameraId: number, timeoutSeconds: number, title: string, reminder: string): Promise<string | null>;
}

const native = requireOptionalNativeModule<TopwiseScanner>('TopwiseScanner');

export const isAvailable = (): boolean => native?.isAvailable() ?? false;

/** `AidlScanParam.BACK_CAMERA` / `FRONT_CAMERA` — which lens the service drives. */
export const BACK_CAMERA = 0;
export const FRONT_CAMERA = 1;

export const scan = async (
  cameraId: number = BACK_CAMERA,
  timeoutSeconds = 30,
  title = 'Aproxime o QR code da sua inscrição',
  reminder = 'Centralize o código na tela',
): Promise<string | null> => (native ? native.scan(cameraId, timeoutSeconds, title, reminder) : null);

export interface ScannerViewProps {
  style?: StyleProp<ViewStyle>;
  /** Stops acting on reads without tearing the camera down — used while a check-in is on screen. */
  paused?: boolean;
  onScanned?: (event: { nativeEvent: { payload: string } }) => void;
  onScanError?: (event: { nativeEvent: { code: number } }) => void;
}

/** Live preview inside our own layout, fed by the vendor service's decode stream. */
export const ScannerView = native ? requireNativeView<ScannerViewProps>('TopwiseScanner') : null;
