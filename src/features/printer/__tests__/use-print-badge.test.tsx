import React from 'react';
import { Button, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { usePrintBadge, type BadgeData, type PrinterModule } from '../use-print-badge';

// Hoisted above these imports by babel-jest, so `../use-print-badge` (which
// imports the native module) never touches the real, absent, native side.
jest.mock('../../../../modules/tspl-usb-printer', () => ({
  isAvailable: false,
  listDevices: () => [],
  requestPermission: async () => false,
  printBitmap: async () => {},
}));

// The default `waitForFrame` uses requestAnimationFrame/setTimeout so a real
// device waits for an actual commit+layout pass before capturing (see
// use-print-badge.tsx). RNTL's `act()` only flushes microtasks and never
// advances real timers, so every test injects a synchronous stand-in.
const noWait = async () => {};

function Harness({ module, capture, deviceName }: { module: PrinterModule; capture: () => Promise<string>; deviceName: string | null }) {
  const { offscreen, print, printing } = usePrintBadge({ deviceName, label: { gapMm: 2, density: 9 }, module, capture, waitForFrame: noWait });
  return (
    <View>
      {offscreen}
      <Button title={printing ? 'imprimindo' : 'imprimir'} onPress={() => void print({ fullName: 'Ana', logoText: 'REACT', link: 'https://x.io' })} />
    </View>
  );
}

describe('usePrintBadge', () => {
  it('captures the offscreen badge and sends it to the selected printer', async () => {
    const module: PrinterModule = { printBitmap: jest.fn().mockResolvedValue(undefined) };
    const capture = jest.fn().mockResolvedValue('PNGBASE64');
    await render(<Harness module={module} capture={capture} deviceName="/dev/p" />);
    await act(async () => {
      fireEvent.press(screen.getByText('imprimir'));
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(module.printBitmap).toHaveBeenCalledWith('/dev/p', 'PNGBASE64', { gapMm: 2, density: 9 });
    expect(screen.getByText('imprimir')).toBeTruthy();
  });

  it('reads label prefs through a getter at print time, so a change between prints is honoured', async () => {
    const module: PrinterModule = { printBitmap: jest.fn().mockResolvedValue(undefined) };
    let prefs = { gapMm: 2, density: 9 };
    function GetterHarness() {
      const { offscreen, print } = usePrintBadge({ deviceName: '/dev/p', label: () => prefs, module, capture: async () => 'PNG', waitForFrame: noWait });
      return (
        <View>
          {offscreen}
          <Button title="imprimir" onPress={() => void print({ fullName: 'Ana', logoText: 'REACT', link: 'https://x.io' })} />
        </View>
      );
    }
    await render(<GetterHarness />);
    await act(async () => {
      fireEvent.press(screen.getByText('imprimir'));
    });
    prefs = { gapMm: 4, density: 12 };
    await act(async () => {
      fireEvent.press(screen.getByText('imprimir'));
    });
    expect(module.printBitmap).toHaveBeenNthCalledWith(1, '/dev/p', 'PNG', { gapMm: 2, density: 9 });
    expect(module.printBitmap).toHaveBeenNthCalledWith(2, '/dev/p', 'PNG', { gapMm: 4, density: 12 });
  });

  it('rejects with a friendly message when there is no printer', async () => {
    const module: PrinterModule = { printBitmap: jest.fn() };
    let error = '';
    function Probe() {
      const { offscreen, print } = usePrintBadge({
        deviceName: null,
        label: { gapMm: 3, density: 8 },
        module,
        capture: async () => 'x',
        waitForFrame: noWait,
      });
      return (
        <View>
          {offscreen}
          <Button title="go" onPress={() => print({ fullName: 'A', logoText: 'B', link: 'c' }).catch((e: Error) => { error = e.message; })} />
        </View>
      );
    }
    await render(<Probe />);
    await act(async () => {
      fireEvent.press(screen.getByText('go'));
    });
    expect(error).toBe('Nenhuma impressora selecionada.');
    expect(module.printBitmap).not.toHaveBeenCalled();
  });

  it('rejects a second print issued before the first one finishes', async () => {
    const module: PrinterModule = { printBitmap: jest.fn().mockResolvedValue(undefined) };
    const capture = jest.fn().mockResolvedValue('PNGBASE64');
    let secondError = '';
    const first: BadgeData = { fullName: 'Ana', logoText: 'REACT', link: 'https://x.io' };
    const second: BadgeData = { fullName: 'Bob', logoText: 'REACT', link: 'https://x.io' };

    function DoublePrintHarness() {
      const { offscreen, print } = usePrintBadge({
        deviceName: '/dev/p',
        label: { gapMm: 2, density: 9 },
        module,
        capture,
        waitForFrame: noWait,
      });
      const onPress = () => {
        void print(first);
        void print(second).catch((e: Error) => {
          secondError = e.message;
        });
      };
      return (
        <View>
          {offscreen}
          <Button title="print-twice" onPress={onPress} />
        </View>
      );
    }

    await render(<DoublePrintHarness />);
    await act(async () => {
      fireEvent.press(screen.getByText('print-twice'));
    });
    expect(secondError).toBe('Já existe uma impressão em andamento.');
    expect(module.printBitmap).toHaveBeenCalledTimes(1);
  });
});
