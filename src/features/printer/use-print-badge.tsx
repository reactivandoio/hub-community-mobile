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

// Waits for React to commit the offscreen badge's new props to the native
// view tree before capturing it. A microtask tick is enough for that commit
// to land and, unlike requestAnimationFrame/setTimeout, resolves inside
// RNTL's `act()` (which flushes microtasks but doesn't advance real timers).
const nextFrame = () => Promise.resolve();

/**
 * Renders the badge offscreen at print resolution, captures it as PNG and sends
 * it to the printer. One print at a time; errors are already user-friendly.
 */
export function usePrintBadge({
  deviceName,
  label,
  module = Printer,
  capture = defaultCapture,
}: {
  deviceName: string | null;
  label: LabelPrefs;
  module?: PrinterModule;
  capture?: Capture;
}) {
  const ref = useRef<View>(null);
  const [data, setData] = useState<BadgeData>({ fullName: '', logoText: '', link: '' });
  const [printing, setPrinting] = useState(false);

  const print = useCallback(
    async (badge: BadgeData) => {
      if (!deviceName) throw new Error('Nenhuma impressora selecionada.');
      if (printing) throw new Error('Já existe uma impressão em andamento.');
      setPrinting(true);
      try {
        setData(badge);
        await nextFrame();
        await nextFrame();
        const png = await capture(ref);
        await module.printBitmap(deviceName, png, { gapMm: label.gapMm, density: label.density });
      } catch (e) {
        throw new Error(friendlyPrinterError(e));
      } finally {
        setPrinting(false);
      }
    },
    [deviceName, printing, capture, module, label.gapMm, label.density],
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
