import { useCallback, useRef, useState, type ReactElement, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { BadgeLabel, BADGE_DOTS } from '@/components/badge-label';
import * as Printer from '../../../modules/tspl-usb-printer';
import type { LabelOptions } from '../../../modules/tspl-usb-printer';
import { friendlyPrinterError } from './printer-errors';
import type { LabelPrefs } from './printer-prefs';

export interface BadgeData {
  fullName: string;
  logoText: string;
  link: string;
}

export interface PrinterModule {
  printBitmap(deviceName: string, pngBase64: string, options: LabelOptions): Promise<void>;
}

type Capture = (ref: RefObject<View | null>) => Promise<string>;

const defaultCapture: Capture = (ref) =>
  captureRef(ref, { format: 'png', quality: 1, result: 'base64', width: BADGE_DOTS.width + 4, height: BADGE_DOTS.height });

// Waits for a real UI frame so React's commit (Fabric) and the native layout
// pass it triggers across the JS/UI-thread bridge have actually landed before
// `capture` reads the native view. requestAnimationFrame ties this to frame
// timing; setTimeout(0) is only a fallback for environments without it.
const defaultWaitForFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

/**
 * Renders the badge offscreen at print resolution, captures it as PNG and sends
 * it to the printer. One print at a time; errors are already user-friendly.
 *
 * `label` may be a getter: it is read at print time, so prefs edited in the
 * settings screen while the check-in screen stays mounted apply to the next
 * badge instead of the values captured on mount.
 */
export function usePrintBadge({
  deviceName,
  label,
  module = Printer,
  capture = defaultCapture,
  waitForFrame = defaultWaitForFrame,
}: {
  deviceName: string | null;
  label: LabelPrefs | (() => LabelPrefs);
  module?: PrinterModule;
  capture?: Capture;
  waitForFrame?: () => Promise<void>;
}) {
  const ref = useRef<View>(null);
  const [data, setData] = useState<BadgeData>({ fullName: '', logoText: '', link: '' });
  const [printing, setPrinting] = useState(false);
  // `printing` (state) drives the UI; this ref is the actual mutex. State
  // updates aren't visible to a `print` call issued before the next render,
  // so two rapid calls would both read `printing === false` and proceed.
  const inFlight = useRef(false);

  const print = useCallback(
    async (badge: BadgeData) => {
      if (!deviceName) throw new Error('Nenhuma impressora selecionada.');
      if (inFlight.current) throw new Error('Já existe uma impressão em andamento.');
      inFlight.current = true;
      setPrinting(true);
      try {
        setData(badge);
        await waitForFrame();
        await waitForFrame();
        const png = await capture(ref);
        const { gapMm, density } = typeof label === 'function' ? label() : label;
        await module.printBitmap(deviceName, png, { gapMm, density });
      } catch (e) {
        throw new Error(friendlyPrinterError(e));
      } finally {
        inFlight.current = false;
        setPrinting(false);
      }
    },
    [deviceName, capture, module, label, waitForFrame],
  );

  const offscreen: ReactElement = (
    <View style={styles.offscreen} pointerEvents="none">
      <BadgeLabel ref={ref} fullName={data.fullName} logoText={data.logoText} link={data.link} width={BADGE_DOTS.width} />
    </View>
  );

  return { offscreen, print, printing };
}

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', left: -10_000, top: 0 },
});
