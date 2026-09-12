import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { readLabelPrefs } from '@/features/printer/printer-prefs';
import { getPrinterStorage, type PrinterState } from '@/features/printer/use-printer';
import { EVENT_BATCHES } from '@/lib/queries';
import { EventSettingsScreen } from '../event-settings-screen';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), back: jest.fn() }) }));
jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }));

const mocks = [
  {
    request: { query: EVENT_BATCHES, variables: { slugOrId: 'ev' } },
    result: {
      data: {
        eventBySlugOrId: {
          __typename: 'Event', id: '1', title: 'Evento',
          products: [{ __typename: 'Product', id: 'p1', name: 'Ingresso', enabled: true, batches: [{ __typename: 'Batch', id: '7', batch_number: 1, value: 0, enabled: true }, { __typename: 'Batch', id: '8', batch_number: 2, value: 50, enabled: false }] }],
        },
      },
    },
  },
];

const device = { deviceName: '/dev/p', vendorId: 1, productId: 2, productName: '4BARCODE', manufacturerName: null, hasPermission: false };

const setup = async () => {
  const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
  store.checkIn('ev', 's1');
  store.outboxFailed('ev', 'u', 'E-mail inválido', { permanent: true });
  const select = jest.fn().mockResolvedValue(true);
  const printer: PrinterState = { available: true, devices: [device], selected: null, ready: false, refresh: () => {}, select };
  await render(
    <MockedProvider mocks={mocks}>
      <CheckinStoreProvider store={store}>
        <EventSettingsScreen slug="ev" printer={printer} />
      </CheckinStoreProvider>
    </MockedProvider>,
  );
  return { store, select };
};

describe('EventSettingsScreen', () => {
  it('edits logo text and link', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByPlaceholderText('Texto do logo'), 'REACTIVANDO');
    await fireEvent.changeText(screen.getByPlaceholderText('Link do QR'), 'https://reactivando.io');
    expect(store.getEvent('ev')!.settings).toMatchObject({ logoText: 'REACTIVANDO', link: 'https://reactivando.io' });
  });

  it('lists enabled batches and stores the chosen one', async () => {
    const { store } = await setup();
    await fireEvent.press(await screen.findByText('Ingresso · Lote 1 (grátis)'));
    expect(screen.queryByText(/Lote 2/)).toBeNull();
    expect(store.getEvent('ev')!.settings.batchId).toBe('7');
  });

  it('selects a printer', async () => {
    const { select } = await setup();
    await act(async () => {
      fireEvent.press(screen.getByText('Selecionar'));
    });
    expect(select).toHaveBeenCalledWith(device);
  });

  it('shows failed outbox items with retry and discard', async () => {
    const { store } = await setup();
    expect(screen.getByText(/E-mail inválido/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Tentar de novo'));
    expect(store.getEvent('ev')!.outbox[0].failed).toBeUndefined();
  });

  it('lets the operator clear and retype the gap field without it snapping back to the default', async () => {
    await setup();
    const gapInput = screen.getByLabelText('Gap (mm)');

    await fireEvent.changeText(gapInput, '');
    expect(gapInput.props.value).toBe('');

    await fireEvent.changeText(gapInput, '2');
    await fireEvent(gapInput, 'blur');
    expect(gapInput.props.value).toBe('2');
    expect(readLabelPrefs(getPrinterStorage()).gapMm).toBe(2);

    await fireEvent.changeText(gapInput, 'abc');
    await fireEvent(gapInput, 'blur');
    expect(gapInput.props.value).toBe('2');
    expect(readLabelPrefs(getPrinterStorage()).gapMm).toBe(2);
  });

  it('lets the operator clear and retype the density field without it snapping back to the default', async () => {
    await setup();
    const densityInput = screen.getByLabelText('Densidade');

    await fireEvent.changeText(densityInput, '');
    expect(densityInput.props.value).toBe('');

    await fireEvent.changeText(densityInput, '5');
    await fireEvent(densityInput, 'blur');
    expect(densityInput.props.value).toBe('5');
    expect(readLabelPrefs(getPrinterStorage()).density).toBe(5);
  });
});
