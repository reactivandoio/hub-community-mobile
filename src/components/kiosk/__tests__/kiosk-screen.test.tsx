import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CheckinStore, MemoryStorage } from '@/features/checkin/store';
import { CheckinStoreProvider } from '@/features/checkin/store-provider';
import { FakeConnectivity, SyncEngine } from '@/features/checkin/sync';
import type { CheckinTransport } from '@/features/checkin/transport';
import type { ServerSignup } from '@/features/checkin/types';
import type { PrinterState } from '@/features/printer/use-printer';
import { KioskScreen, maskEmail } from '../kiosk-screen';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
jest.mock('../../../../modules/tspl-usb-printer', () => ({ isAvailable: false, listDevices: () => [], requestPermission: async () => false, printBitmap: async () => {} }));

// The totem's barcode reader is a keyboard: it types the payload into the
// focused field and presses Enter. That is what a scan looks like here.
const field = () => screen.getByPlaceholderText('Seu nome');
const showQr = async (data: string) => {
  await act(async () => fireEvent.changeText(field(), data));
  await act(async () => fireEvent(field(), 'submitEditing'));
};

const device = { deviceName: '/dev/p', vendorId: 1, productId: 1, productName: 'P', manufacturerName: null, hasPermission: true };
const printer = (ready: boolean): PrinterState => ({ available: true, devices: [], selected: ready ? device : null, ready, permissionDenied: false, refresh: () => {}, select: async () => true });

// What the server answers; the engine pulls on mount and the merge drops anything missing from it.
const server: ServerSignup[] = [
  { id: 's1', name: 'José Ção', email: 'jose@x.io', product_name: 'Lote 1' },
  { id: 's2', name: 'Bia', checked_in: true, checked_in_at: '2026-09-18T09:30:00.000Z' },
];

const setup = async ({ ready = true, printBadge = jest.fn().mockResolvedValue(undefined), fetchSignups = async () => server }: { ready?: boolean; printBadge?: jest.Mock; fetchSignups?: CheckinTransport['fetchSignups'] } = {}) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-18T10:00:00.000Z', uuid: () => 'u' });
  store.loadEvent('ev', 'Meetup', server);
  const transport: CheckinTransport = { fetchSignups, checkin: async () => ({ success: true }), walkin: async () => ({ success: true }) };
  const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(true) });
  const syncNow = jest.spyOn(engine, 'syncNow');
  await render(
    <MockedProvider mocks={[]}>
      <CheckinStoreProvider store={store}>
        <KioskScreen slug="ev" engine={engine} printer={printer(ready)} printBadge={printBadge} resetAfterMs={60_000} />
      </CheckinStoreProvider>
    </MockedProvider>,
  );
  return { store, printBadge, syncNow };
};

describe('KioskScreen', () => {
  it('shows the name field and the signup QR, with no chrome around them', async () => {
    await setup();
    expect(screen.getByText('Digite seu nome para retirar o crachá')).toBeTruthy();
    expect(screen.getByText('Ainda não se inscreveu?')).toBeTruthy();
    // No header: the totem is for the attendee, who does not need the event
    // name, and everything has to fit one screen without scrolling.
    expect(screen.queryByText('Meetup')).toBeNull();
  });

  it('says so when no signup is cached, instead of answering every search with "not found"', async () => {
    const store = new CheckinStore({ storage: new MemoryStorage(), now: () => '2026-09-18T10:00:00.000Z', uuid: () => 'u' });
    store.loadEvent('ev', 'Meetup', []);
    const transport: CheckinTransport = { fetchSignups: async () => [], checkin: async () => ({ success: true }), walkin: async () => ({ success: true }) };
    const engine = new SyncEngine({ store, transport, connectivity: new FakeConnectivity(true) });
    await render(
      <MockedProvider mocks={[]}>
        <CheckinStoreProvider store={store}>
          <KioskScreen slug="ev" engine={engine} printer={printer(true)} printBadge={jest.fn()} resetAfterMs={60_000} />
        </CheckinStoreProvider>
      </MockedProvider>,
    );

    expect(screen.getByText(/Nenhum inscrito carregado neste aparelho/)).toBeTruthy();
  });

  it('hides the signup QR while someone types, so the keyboard does not bury the results', async () => {
    await setup();
    expect(screen.getByText('Ainda não se inscreveu?')).toBeTruthy();

    await act(async () => fireEvent(field(), 'focus'));
    expect(screen.queryByText('Ainda não se inscreveu?')).toBeNull();

    await act(async () => fireEvent(field(), 'blur'));
    expect(screen.getByText('Ainda não se inscreveu?')).toBeTruthy();
  });

  it('scanning a ticket prints, checks in and welcomes the person without confirmation', async () => {
    const { store, printBadge } = await setup();
    await showQr('https://hubcommunity.io/events/ev/signup?ticket=s1');
    expect(printBadge).toHaveBeenCalledWith({ fullName: 'José Ção', logoText: 'COMUNIDADE', link: 'https://hubcommunity.io' });
    expect(store.getEvent('ev')!.signups[0]).toMatchObject({ checked_in: true, printed_at: '2026-09-18T10:00:00.000Z' });
    expect(screen.getByText('José!')).toBeTruthy();
    expect(screen.getByText('Retire seu crachá na impressora.')).toBeTruthy();
    // The field stops taking input while the welcome screen is up, so the next
    // person in the queue cannot scan over someone else's badge.
    expect(field()).toBeDisabled();
    await fireEvent.press(screen.getByText('Próximo'));
    expect(field()).not.toBeDisabled();
  });

  it('name search needs two characters, masks e-mails and asks for confirmation', async () => {
    const { store } = await setup();
    await fireEvent.changeText(screen.getByPlaceholderText('Seu nome'), 'j');
    expect(screen.queryByText('José Ção')).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('Seu nome'), 'cao');
    expect(screen.getByText('jo***@x.io · Lote 1')).toBeTruthy();
    expect(screen.queryByText('jose@x.io')).toBeNull();
    await fireEvent.press(screen.getByText('José Ção'));
    expect(screen.getByText('É você?')).toBeTruthy();
    expect(store.getEvent('ev')!.signups[0].checked_in).toBe(false);
    await fireEvent.press(screen.getByText('Não sou eu'));
    expect(screen.queryByText('É você?')).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('Seu nome'), 'jos');
    await fireEvent.press(screen.getByText('José Ção'));
    await fireEvent.press(screen.getByText('Sim, sou eu'));
    expect(store.getEvent('ev')!.signups[0].checked_in).toBe(true);
    expect(screen.getByText('José!')).toBeTruthy();
  });

  it('checks in without a badge when there is no printer and sends people to the desk', async () => {
    const { store, printBadge } = await setup({ ready: false });
    await showQr('s1');
    expect(printBadge).not.toHaveBeenCalled();
    expect(store.getEvent('ev')!.signups[0].checked_in).toBe(true);
    expect(screen.getByText('Retire seu crachá na recepção.')).toBeTruthy();
    expect(screen.getByText('Imprimir crachá')).toBeDisabled();
  });

  it('tells someone already credentialed and lets them reprint', async () => {
    const { printBadge } = await setup();
    await showQr('s2');
    expect(screen.getByText('Você já fez check-in')).toBeTruthy();
    expect(screen.getByText(/Credenciado às \d\d:\d\d\./)).toBeTruthy();
    await fireEvent.press(screen.getByText('Imprimir crachá'));
    expect(printBadge).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Bia' }));
    expect(screen.getByText('Retire seu crachá na impressora.')).toBeTruthy();
  });

  it('an unknown ticket triggers a sync and, if still missing, says not found', async () => {
    const { syncNow } = await setup();
    await showQr('https://hubcommunity.io/events/ev/signup?ticket=nope');
    expect(syncNow).toHaveBeenCalled();
    expect(screen.getByText('Inscrição não encontrada')).toBeTruthy();
    await fireEvent.press(screen.getByText('Tentar de novo'));
    expect(screen.queryByText('Inscrição não encontrada')).toBeNull();
  });

  it('a ticket that arrives with the sync is credentialed', async () => {
    const { store } = await setup({ fetchSignups: async () => [...server, { id: 's9', name: 'Novo Inscrito' }] });
    await showQr('https://hubcommunity.io/events/ev/signup?ticket=s9');
    expect(store.getEvent('ev')!.signups.find((s) => s.id === 's9')).toMatchObject({ checked_in: true });
    expect(screen.getByText('Novo!')).toBeTruthy();
  });

  it('leaves the kiosk only through the hidden long-press plus confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await setup();
    await fireEvent(screen.getByLabelText('Sair do modo totem'), 'longPress');
    expect(alert).toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Sair')!.onPress!();
    expect(mockBack).toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe('maskEmail', () => {
  it('keeps two characters and the domain', () => {
    expect(maskEmail('jose@x.io')).toBe('jo***@x.io');
    expect(maskEmail('a@x.io')).toBe('a***@x.io');
    expect(maskEmail('')).toBeNull();
    expect(maskEmail('semarroba')).toBeNull();
  });
});
