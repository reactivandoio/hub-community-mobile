import { act, renderHook } from '@testing-library/react-native';
import type { LocalSignup } from '@/features/checkin/types';
import { useKioskFlow, type KioskDeps } from '../use-kiosk-flow';

const ana: LocalSignup = { id: 's1', name: 'Ana', email: 'ana@x.io', checked_in: false, source: 'server' };
const bia: LocalSignup = { id: 's2', name: 'Bia', checked_in: true, checked_in_at: '2026-09-18T09:30:00.000Z', source: 'server' };
const TICKET = 'https://hubcommunity.io/events/ev/signup?ticket=s1';

const makeDeps = (over: Partial<KioskDeps> = {}) => {
  const signups = new Map<string, LocalSignup>([
    [ana.id, ana],
    [bia.id, bia],
  ]);
  const deps: KioskDeps = {
    findSignup: (id) => signups.get(id),
    badge: (s) => ({ fullName: s.name, logoText: 'X', link: 'https://x.io' }),
    printerReady: true,
    print: jest.fn().mockResolvedValue(undefined),
    checkIn: jest.fn((id: string) => {
      const s = signups.get(id);
      if (s) signups.set(id, { ...s, checked_in: true, checked_in_at: '2026-09-18T10:00:00.000Z' });
    }),
    markPrinted: jest.fn(),
    syncNow: jest.fn().mockResolvedValue(undefined),
    resetAfterMs: 5000,
    ...over,
  };
  return { deps, signups };
};

const flush = () => act(async () => {});
/** A promise the test resolves by hand, to observe the state while it is pending. */
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useKioskFlow', () => {
  it('scan → prints, checks in and shows the welcome screen without confirmation', async () => {
    const printing = deferred<void>();
    const { deps } = makeDeps({ print: jest.fn(() => printing.promise) });
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.scan(TICKET));
    expect(result.current.state.kind).toBe('printing');
    expect(deps.checkIn).not.toHaveBeenCalled();
    await act(async () => printing.resolve());
    expect(deps.print).toHaveBeenCalledWith({ fullName: 'Ana', logoText: 'X', link: 'https://x.io' });
    expect(deps.checkIn).toHaveBeenCalledWith('s1');
    expect(deps.markPrinted).toHaveBeenCalledWith('s1');
    expect(result.current.state).toMatchObject({ kind: 'done', printed: true, alreadyCheckedIn: false, signup: { id: 's1', checked_in: true } });
    await act(() => jest.advanceTimersByTime(5000));
    expect(result.current.state.kind).toBe('idle');
  });

  it('search pick → asks for confirmation before credentialing', async () => {
    const { deps } = makeDeps();
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.select(ana));
    expect(result.current.state).toMatchObject({ kind: 'confirm', signup: { id: 's1' } });
    expect(deps.checkIn).not.toHaveBeenCalled();
    await act(() => result.current.confirm());
    await flush();
    expect(deps.checkIn).toHaveBeenCalledWith('s1');
    expect(result.current.state.kind).toBe('done');
  });

  it('cancel from confirm goes back to idle without a check-in', async () => {
    const { deps } = makeDeps();
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.select(ana));
    await act(() => result.current.cancel());
    expect(result.current.state.kind).toBe('idle');
    expect(deps.checkIn).not.toHaveBeenCalled();
  });

  it('still checks in when the printer is not ready or fails, and says so', async () => {
    const { deps } = makeDeps({ printerReady: false });
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.scan(TICKET));
    await flush();
    expect(deps.print).not.toHaveBeenCalled();
    expect(deps.checkIn).toHaveBeenCalledWith('s1');
    expect(deps.markPrinted).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ kind: 'done', printed: false });

    const failing = makeDeps({ print: jest.fn().mockRejectedValue(new Error('Sem papel')) });
    const h2 = await renderHook(() => useKioskFlow(failing.deps));
    await act(() => h2.result.current.scan(TICKET));
    await flush();
    expect(failing.deps.checkIn).toHaveBeenCalledWith('s1');
    expect(h2.result.current.state).toMatchObject({ kind: 'done', printed: false, error: 'Sem papel' });
  });

  it('an already credentialed person sees that and can reprint', async () => {
    const printing = deferred<void>();
    const { deps } = makeDeps({ print: jest.fn(() => printing.promise) });
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.scan('s2'));
    expect(result.current.state).toMatchObject({ kind: 'done', alreadyCheckedIn: true, printed: false });
    expect(deps.checkIn).not.toHaveBeenCalled();
    await act(() => result.current.reprint());
    expect(result.current.state.kind).toBe('printing');
    await act(async () => printing.resolve());
    expect(deps.print).toHaveBeenCalledTimes(1);
    expect(deps.markPrinted).toHaveBeenCalledWith('s2');
    expect(result.current.state).toMatchObject({ kind: 'done', alreadyCheckedIn: true, printed: true });
  });

  it('unknown ticket → syncs once, then credentials if it appeared or reports not found', async () => {
    const syncing = deferred<void>();
    const { deps, signups } = makeDeps({ syncNow: jest.fn(() => syncing.promise) });
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.scan('https://x.io/?ticket=s9'));
    expect(result.current.state.kind).toBe('looking_up');
    signups.set('s9', { id: 's9', name: 'Novo', checked_in: false, source: 'server' });
    await act(async () => syncing.resolve());
    expect(deps.syncNow).toHaveBeenCalledTimes(1);
    expect(deps.checkIn).toHaveBeenCalledWith('s9');
    expect(result.current.state.kind).toBe('done');

    const missing = makeDeps();
    const h2 = await renderHook(() => useKioskFlow(missing.deps));
    await act(() => h2.result.current.scan('nope'));
    await flush();
    expect(missing.deps.syncNow).toHaveBeenCalledTimes(1);
    expect(h2.result.current.state.kind).toBe('not_found');
    await act(() => jest.advanceTimersByTime(5000));
    expect(h2.result.current.state.kind).toBe('idle');
  });

  it('ignores scans while busy, repeated payloads and payloads that are not tickets', async () => {
    let t = 0;
    const { deps } = makeDeps({ now: () => t, rescanAfterMs: 4000 });
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.scan('https://hubcommunity.io'));
    expect(result.current.state.kind).toBe('idle');
    expect(deps.syncNow).not.toHaveBeenCalled();

    await act(() => result.current.scan(TICKET));
    await act(() => result.current.scan('s2'));
    await flush();
    expect(deps.checkIn).toHaveBeenCalledTimes(1);
    await act(() => result.current.next());
    t = 3000;
    await act(() => result.current.scan(TICKET));
    expect(result.current.state.kind).toBe('idle');
    t = 4001;
    await act(() => result.current.scan(TICKET));
    await flush();
    expect(result.current.state).toMatchObject({ kind: 'done', alreadyCheckedIn: true });
  });

  it('a slow sync cannot resurrect a screen the operator already advanced', async () => {
    let release!: () => void;
    const { deps } = makeDeps({ syncNow: () => new Promise<void>((r) => (release = r)) });
    const { result } = await renderHook(() => useKioskFlow(deps));
    await act(() => result.current.scan('ghost'));
    expect(result.current.state.kind).toBe('looking_up');
    await act(() => result.current.next());
    release();
    await flush();
    expect(result.current.state.kind).toBe('idle');
  });
});
