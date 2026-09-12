import { CheckinStore, MemoryStorage } from '../store';
import type { ServerSignup } from '../types';

const server: ServerSignup[] = [
  { id: 's1', name: 'Ana', email: 'ana@x.io', checked_in: false },
  { id: 's2', name: 'Bia', email: 'bia@x.io', checked_in: true, checked_in_at: '2026-09-12T07:00:00.000Z' },
];

const make = () => {
  const storage = new MemoryStorage();
  let tick = 0;
  const store = new CheckinStore({
    storage,
    now: () => `2026-09-12T10:00:0${tick++}.000Z`,
    uuid: () => 'uuid-1',
  });
  return { storage, store };
};

describe('CheckinStore', () => {
  it('loads an event, lists it and persists it', () => {
    const { store, storage } = make();
    store.loadEvent('ev', 'Evento', server);
    expect(store.getEvent('ev')?.signups.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(store.listEvents()).toEqual([{ slug: 'ev', title: 'Evento', loadedAt: '2026-09-12T10:00:00.000Z', lastPullAt: '2026-09-12T10:00:00.000Z' }]);
    expect(JSON.parse(storage.getString('checkin:ev')!).title).toBe('Evento');
  });

  it('rehydrates from storage', () => {
    const { store, storage } = make();
    store.loadEvent('ev', 'Evento', server);
    const again = new CheckinStore({ storage });
    expect(again.getEvent('ev')?.signups).toHaveLength(2);
    expect(again.listEvents()[0].slug).toBe('ev');
  });

  it('checks in once and enqueues one checkin item', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    store.checkIn('ev', 's1');
    const ev = store.getEvent('ev')!;
    expect(ev.signups[0]).toMatchObject({ checked_in: true, checked_in_at: '2026-09-12T10:00:01.000Z' });
    expect(ev.outbox).toEqual([
      { id: 'uuid-1', kind: 'checkin', signupId: 's1', checkedInAt: '2026-09-12T10:00:01.000Z', createdAt: '2026-09-12T10:00:01.000Z', attempts: 0 },
    ]);
  });

  it('can check in without enqueueing', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1', { enqueue: false });
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('adds a walk-in as a local signup and enqueues it', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.updateSettings('ev', { batchId: '7' });
    const created = store.addWalkin('ev', { name: 'Caio', email: 'caio@x.io', phone_number: '62' });
    expect(created).toMatchObject({ id: 'local:uuid-1', name: 'Caio', source: 'walkin', checked_in: false });
    const ev = store.getEvent('ev')!;
    expect(ev.signups.at(-1)?.id).toBe('local:uuid-1');
    expect(ev.outbox[0]).toMatchObject({ kind: 'walkin', localId: 'local:uuid-1', batchId: '7', input: { name: 'Caio', email: 'caio@x.io', phone_number: '62' } });
  });

  it('resolves a walk-in: remaps the signup id and pending outbox items', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    const created = store.addWalkin('ev', { name: 'Caio', email: 'caio@x.io' });
    store.checkIn('ev', created.id);
    store.resolveWalkin('ev', created.id, { id: 's9', name: 'Caio Melo', email: 'caio@x.io', product_name: 'Lote 1' });
    const ev = store.getEvent('ev')!;
    expect(ev.signups.find((s) => s.id === 's9')).toMatchObject({ name: 'Caio Melo', product_name: 'Lote 1', checked_in: true, source: 'walkin' });
    expect(ev.signups.some((s) => s.id === created.id)).toBe(false);
    const checkin = ev.outbox.find((i) => i.kind === 'checkin');
    expect(checkin).toMatchObject({ signupId: 's9' });
  });

  it('merges a pull without losing local check-ins', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    store.applyPull('ev', [{ id: 's1', name: 'Ana Souza', checked_in: false }, { id: 's3', name: 'Dan' }]);
    const ev = store.getEvent('ev')!;
    expect(ev.signups.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(ev.signups[0]).toMatchObject({ name: 'Ana Souza', checked_in: true });
    expect(ev.lastPullAt).toBe('2026-09-12T10:00:02.000Z');
  });

  it('tracks outbox failures with backoff, retry and discard', () => {
    const { store } = make();
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    const [item] = store.getEvent('ev')!.outbox;
    store.outboxFailed('ev', item.id, 'timeout', { permanent: false });
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ attempts: 1, lastError: 'timeout', nextAttemptAt: '2026-09-12T10:00:07.000Z' });
    store.outboxFailed('ev', item.id, 'bad email', { permanent: true });
    expect(store.getEvent('ev')!.outbox[0]).toMatchObject({ failed: true, lastError: 'bad email' });
    store.retryOutboxItem('ev', item.id);
    expect(store.getEvent('ev')!.outbox[0].failed).toBeUndefined();
    expect(store.getEvent('ev')!.outbox[0].nextAttemptAt).toBeUndefined();
    store.discardOutboxItem('ev', item.id);
    expect(store.getEvent('ev')!.outbox).toEqual([]);
  });

  it('removes done items and notifies subscribers', () => {
    const { store } = make();
    const listener = jest.fn();
    store.subscribe(listener);
    store.loadEvent('ev', 'Evento', server);
    store.checkIn('ev', 's1');
    const [item] = store.getEvent('ev')!.outbox;
    store.outboxSucceeded('ev', item.id);
    expect(store.getEvent('ev')!.outbox).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('marks printed and removes events', () => {
    const { store, storage } = make();
    store.loadEvent('ev', 'Evento', server);
    store.markPrinted('ev', 's2');
    expect(store.getEvent('ev')!.signups[1].printed_at).toBe('2026-09-12T10:00:01.000Z');
    store.removeEvent('ev');
    expect(store.getEvent('ev')).toBeUndefined();
    expect(storage.getString('checkin:ev')).toBeUndefined();
    expect(store.listEvents()).toEqual([]);
  });
});
