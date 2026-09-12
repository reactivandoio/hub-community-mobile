import { CheckinStore, MemoryStorage } from '../store';
import { FakeConnectivity, SyncEngine } from '../sync';
import { NetworkError, type CheckinTransport } from '../transport';

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

const make = (online = true) => {
  const store = new CheckinStore({ storage: new MemoryStorage(), uuid: () => 'u' });
  store.loadEvent('ev', 'Evento', [{ id: 's1', name: 'Ana' }]);
  const transport: jest.Mocked<CheckinTransport> = {
    fetchSignups: jest.fn().mockResolvedValue([{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bia' }]),
    checkin: jest.fn().mockResolvedValue({ success: true }),
    walkin: jest.fn().mockResolvedValue({ success: true, signup: { id: 's9', name: 'C' } }),
  };
  const connectivity = new FakeConnectivity(online);
  const engine = new SyncEngine({ store, transport, connectivity, pullIntervalMs: 30_000 });
  return { store, transport, connectivity, engine };
};

beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
afterEach(() => jest.useRealTimers());

describe('SyncEngine', () => {
  it('pulls immediately on start and every interval while online', async () => {
    const { engine, transport, store } = make();
    engine.start('ev');
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    expect(store.getEvent('ev')!.signups).toHaveLength(2);
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(2);
    engine.stop();
    jest.advanceTimersByTime(60_000);
    expect(transport.fetchSignups).toHaveBeenCalledTimes(2);
  });

  it('does nothing while offline and syncs when connectivity returns', async () => {
    const { engine, transport, connectivity, store } = make(false);
    store.checkIn('ev', 's1');
    engine.start('ev');
    await flush();
    expect(transport.fetchSignups).not.toHaveBeenCalled();
    expect(engine.getStatus().online).toBe(false);
    connectivity.set(true);
    await flush();
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
    expect(transport.checkin).toHaveBeenCalledWith('ev', 's1', expect.any(String));
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('pushes new outbox items as they are enqueued', async () => {
    const { engine, transport, store } = make();
    engine.start('ev');
    await flush();
    store.checkIn('ev', 's1');
    await flush();
    expect(transport.checkin).toHaveBeenCalledTimes(1);
  });

  it('records network failures in the status and keeps going', async () => {
    const { engine, transport } = make();
    transport.fetchSignups.mockRejectedValueOnce(new NetworkError('offline'));
    engine.start('ev');
    await flush();
    expect(engine.getStatus()).toMatchObject({ syncing: false, lastError: 'offline' });
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(engine.getStatus().lastError).toBeUndefined();
    expect(engine.getStatus().lastSyncAt).toEqual(expect.any(String));
  });

  it('syncNow runs pull and push once even if called twice concurrently', async () => {
    const { engine, transport } = make();
    engine.start('ev');
    await flush();
    transport.fetchSignups.mockClear();
    await Promise.all([engine.syncNow(), engine.syncNow()]);
    expect(transport.fetchSignups).toHaveBeenCalledTimes(1);
  });
});
