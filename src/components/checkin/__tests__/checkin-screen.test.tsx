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

const device = (hasPermission: boolean) => ({ deviceName: '/dev/p', vendorId: 1, productId: 1, productName: 'P', manufacturerName: null, hasPermission });
const printer = (ready: boolean): PrinterState => ({ available: true, devices: [], selected: ready ? device(true) : null, ready, permissionDenied: false, refresh: () => {}, select: async () => true });
const unpermitted: PrinterState = { ...printer(false), devices: [device(false)], selected: device(false), permissionDenied: true };

const setup = async ({ ready = true, printerState, printBadge = jest.fn().mockResolvedValue(undefined), select, selectKey }: { ready?: boolean; printerState?: PrinterState; printBadge?: jest.Mock; select?: string; selectKey?: string } = {}) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-12T10:00:00.000Z', uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [
    { id: 's1', name: 'José Ção', email: 'jose@x.io', product_name: 'Lote 1' },
    { id: 's2', name: 'Bia', checked_in: true, checked_in_at: '2026-09-12T09:30:00.000Z' },
  ]);
  const transport: CheckinTransport = { fetchSignups: async () => [], checkin: async () => ({ success: true }), walkin: async () => ({ success: true }) };
  const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(false) });
  const ui = (props: { select?: string; selectKey?: string }) => (
    <MockedProvider mocks={[]}>
      <CheckinStoreProvider store={store}>
        <CheckinScreen slug="ev" engine={engine} printer={printerState ?? printer(ready)} printBadge={printBadge} {...props} />
      </CheckinStoreProvider>
    </MockedProvider>
  );
  const { rerender } = await render(ui({ select, selectKey }));
  return { store, printBadge, rerender: (props: { select?: string; selectKey?: string }) => rerender(ui(props)) };
};

describe('CheckinScreen', () => {
  it('lists signups, filters without accents and shows the status bar', async () => {
    await setup();
    expect(screen.getByText('José Ção')).toBeTruthy();
    expect(screen.getByText('Bia')).toBeTruthy();
    expect(screen.getByText(/offline/i)).toBeTruthy();
    expect(screen.getByText('Sincronizar agora')).not.toBeDisabled();
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

  it('explains a missing USB permission instead of claiming there is no printer', async () => {
    await setup({ printerState: unpermitted });
    await fireEvent.press(screen.getByText('José Ção'));
    expect(screen.getByText('Imprimir e credenciar')).toBeDisabled();
    expect(screen.getByText('Impressora sem permissão — toque em Selecionar nas configurações')).toBeTruthy();
    expect(screen.queryByText('Sem impressora selecionada')).toBeNull();
    expect(screen.getByText('Credenciar sem imprimir')).toBeTruthy();
  });

  it('opens the sheet for the signup named by the select param, on mount and when it changes', async () => {
    const { rerender } = await setup({ select: 's1', selectKey: '1' });
    expect(screen.getByText('Imprimir e credenciar')).toBeTruthy();
    expect(screen.getAllByText('José Ção')).toHaveLength(2);
    await fireEvent.press(screen.getByText('Fechar'));
    expect(screen.queryByText('Imprimir e credenciar')).toBeNull();
    // Same signup asked for again from the walk-in form (new key) reopens it.
    await act(async () => {
      await rerender({ select: 's1', selectKey: '2' });
    });
    expect(screen.getByText('Imprimir e credenciar')).toBeTruthy();
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
