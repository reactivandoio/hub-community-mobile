import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import type { PrinterState } from '@/features/printer/use-printer';
import { WalkinForm } from '../walkin-form';

jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }));

const printer: PrinterState = { available: true, devices: [], selected: { deviceName: '/dev/p', vendorId: 1, productId: 1, productName: 'P', manufacturerName: null, hasPermission: true }, ready: true, refresh: () => {}, select: async () => true };

const setup = async ({ batchId = '7', printBadge = jest.fn().mockResolvedValue(undefined) } = {}) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana', email: 'Ana@x.io' }]);
  store.updateSettings('ev', { batchId });
  const onDone = jest.fn();
  await render(
    <CheckinStoreProvider store={store}>
      <WalkinForm slug="ev" printer={printer} printBadge={printBadge} onDone={onDone} />
    </CheckinStoreProvider>,
  );
  return { store, onDone, printBadge };
};

const fill = async (name: string, email: string) => {
  await fireEvent.changeText(screen.getByPlaceholderText('Nome completo'), name);
  await fireEvent.changeText(screen.getByPlaceholderText('E-mail'), email);
};

describe('WalkinForm', () => {
  it('validates required fields', async () => {
    await setup();
    await fireEvent.press(screen.getByText('Imprimir e inscrever'));
    expect(screen.getByText('Informe o nome')).toBeTruthy();
    await fill('Caio', 'caio');
    await fireEvent.press(screen.getByText('Imprimir e inscrever'));
    expect(screen.getByText('E-mail inválido')).toBeTruthy();
  });

  it('detects an email that is already signed up', async () => {
    const { onDone } = await setup();
    await fill('Ana', 'ana@X.IO ');
    await fireEvent.press(screen.getByText('Imprimir e inscrever'));
    expect(screen.getByText('Este e-mail já está inscrito')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ir para o check-in'));
    expect(onDone).toHaveBeenCalledWith('s1');
  });

  it('creates the walk-in, prints, checks in and enqueues both operations', async () => {
    const { store, onDone, printBadge } = await setup();
    await fill('Caio Melo', 'caio@x.io');
    await fireEvent.changeText(screen.getByPlaceholderText('Telefone (opcional)'), '62999');
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e inscrever'));
    });
    expect(printBadge).toHaveBeenCalledWith({ fullName: 'Caio Melo', logoText: 'COMUNIDADE', link: 'https://hubcommunity.io' });
    const ev = store.getEvent('ev')!;
    expect(ev.signups.at(-1)).toMatchObject({ id: 'local:u', name: 'Caio Melo', email: 'caio@x.io', phone_number: '62999', checked_in: true, printed_at: expect.any(String) });
    expect(ev.outbox.map((i) => i.kind)).toEqual(['walkin', 'checkin']);
    expect(onDone).toHaveBeenCalledWith('local:u');
  });

  it('keeps the signup when printing fails', async () => {
    const { store } = await setup({ printBadge: jest.fn().mockRejectedValue(new Error('Impressora desconectada. Confira o cabo USB.')) });
    await fill('Caio', 'caio@x.io');
    await act(async () => {
      fireEvent.press(screen.getByText('Imprimir e inscrever'));
    });
    expect(screen.getByText(/crachá não impresso: Impressora desconectada/)).toBeTruthy();
    expect(store.getEvent('ev')!.signups.at(-1)).toMatchObject({ name: 'Caio', checked_in: true });
  });

  it('blocks when no batch is configured', async () => {
    await setup({ batchId: '' });
    expect(screen.getByText('Selecione o lote nas configurações antes de inscrever')).toBeTruthy();
  });
});
