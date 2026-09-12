import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { FakeConnectivity, SyncEngine } from '@/features/checkin/sync';
import type { CheckinTransport } from '@/features/checkin/transport';
import type { PrinterState } from '@/features/printer/use-printer';
import { CheckinScreen } from '../checkin-screen';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }));

const printer = (ready: boolean): PrinterState => ({ available: true, devices: [], selected: ready ? { deviceName: '/dev/p', vendorId: 1, productId: 1, productName: 'P', manufacturerName: null, hasPermission: true } : null, ready, refresh: () => {}, select: async () => true });

const setup = async ({ ready = true, printBadge = jest.fn().mockResolvedValue(undefined) } = {}) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-12T10:00:00.000Z', uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [
    { id: 's1', name: 'José Ção', email: 'jose@x.io', product_name: 'Lote 1' },
    { id: 's2', name: 'Bia', checked_in: true, checked_in_at: '2026-09-12T09:30:00.000Z' },
  ]);
  const transport: CheckinTransport = { fetchSignups: async () => [], checkin: async () => ({ success: true }), walkin: async () => ({ success: true }) };
  const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(false) });
  await render(
    <MockedProvider mocks={[]}>
      <CheckinStoreProvider store={store}>
        <CheckinScreen slug="ev" engine={engine} printer={printer(ready)} printBadge={printBadge} />
      </CheckinStoreProvider>
    </MockedProvider>,
  );
  return { store, printBadge };
};

describe('CheckinScreen', () => {
  it('lists signups, filters without accents and shows the status bar', async () => {
    await setup();
    expect(screen.getByText('José Ção')).toBeTruthy();
    expect(screen.getByText('Bia')).toBeTruthy();
    expect(screen.getByText(/offline/i)).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText('Buscar por nome ou e-mail'), 'cao');
    expect(screen.queryByText('Bia')).toBeNull();
    expect(screen.getByText('José Ção')).toBeTruthy();
  });

  it('prints and checks in from the sheet', async () => {
    const { store, printBadge } = await setup();
    await fireEvent.press(screen.getByText('José Ção'));
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e credenciar'));
    });
    expect(printBadge).toHaveBeenCalledWith({ fullName: 'José Ção', logoText: 'COMUNIDADE', link: 'https://hubcommunity.io' });
    const s1 = store.getEvent('ev')!.signups[0];
    expect(s1).toMatchObject({ checked_in: true, printed_at: '2026-09-12T10:00:00.000Z' });
    expect(store.getEvent('ev')!.outbox).toHaveLength(1);
    expect(screen.getByText(/1 pendente/)).toBeTruthy();
  });

  it('offers check-in without printing when printing fails', async () => {
    const { store } = await setup({ printBadge: jest.fn().mockRejectedValue(new Error('Impressora desconectada. Confira o cabo USB.')) });
    await fireEvent.press(screen.getByText('José Ção'));
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e credenciar'));
    });
    expect(screen.getByText('Impressora desconectada. Confira o cabo USB.')).toBeTruthy();
    expect(store.getEvent('ev')!.signups[0].checked_in).toBe(false);
    await fireEvent.press(screen.getByText('Credenciar sem imprimir'));
    expect(store.getEvent('ev')!.signups[0].checked_in).toBe(true);
  });

  it('disables printing when no printer is ready and shows reprint for checked-in people', async () => {
    const { printBadge } = await setup({ ready: false });
    await fireEvent.press(screen.getByText('Bia'));
    expect(screen.getByText(/Credenciado às/)).toBeTruthy();
    expect(screen.getByText('Reimprimir')).toBeDisabled();
    expect(screen.getByText('Sem impressora selecionada')).toBeTruthy();
    expect(printBadge).not.toHaveBeenCalled();
  });
});
