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

// The camera mock exposes the latest `onBarcodeScanned` so tests can "show" a QR.
const mockCamera: { scan?: (r: { data: string; type: string }) => void; granted: boolean; request: jest.Mock } = { granted: true, request: jest.fn() };
jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned?: (r: { data: string; type: string }) => void }) => {
    mockCamera.scan = props.onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [{ granted: mockCamera.granted }, mockCamera.request],
}));
const showQr = (data: string) => act(async () => mockCamera.scan?.({ data, type: 'qr' }));

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

beforeEach(() => {
  mockCamera.scan = undefined;
  mockCamera.granted = true;
});

describe('KioskScreen', () => {
  it('shows the event, the camera prompt and the signup QR', async () => {
    await setup();
    expect(screen.getByText('Meetup')).toBeTruthy();
    expect(screen.getByText('Aproxime o QR code da sua inscrição')).toBeTruthy();
    expect(screen.getByText('Ainda não se inscreveu?')).toBeTruthy();
    expect(mockCamera.scan).toBeDefined();
  });

  it('scanning a ticket prints, checks in and welcomes the person without confirmation', async () => {
    const { store, printBadge } = await setup();
    await showQr('https://hubcommunity.io/events/ev/signup?ticket=s1');
    expect(printBadge).toHaveBeenCalledWith({ fullName: 'José Ção', logoText: 'COMUNIDADE', link: 'https://hubcommunity.io' });
    expect(store.getEvent('ev')!.signups[0]).toMatchObject({ checked_in: true, printed_at: '2026-09-18T10:00:00.000Z' });
    expect(screen.getByText('José!')).toBeTruthy();
    expect(screen.getByText('Retire seu crachá na impressora.')).toBeTruthy();
    // The camera stops feeding scans while the welcome screen is up.
    expect(mockCamera.scan).toBeUndefined();
    await fireEvent.press(screen.getByText('Próximo'));
    expect(mockCamera.scan).toBeDefined();
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

  it('offers to enable the camera and keeps the search working without it', async () => {
    mockCamera.granted = false;
    await setup();
    expect(mockCamera.scan).toBeUndefined();
    await fireEvent.press(screen.getByText('Permitir câmera'));
    expect(mockCamera.request).toHaveBeenCalled();
    await fireEvent.changeText(screen.getByPlaceholderText('Seu nome'), 'bia');
    expect(screen.getByText('Bia')).toBeTruthy();
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
