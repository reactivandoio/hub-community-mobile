import { matchesSearch, mergeSignups, normalize } from '../merge';
import type { LocalSignup, ServerSignup } from '../types';

const server = (over: Partial<ServerSignup> & { id: string }): ServerSignup => ({ name: 'X', ...over });
const local = (over: Partial<LocalSignup> & { id: string }): LocalSignup => ({
  name: 'X',
  checked_in: false,
  source: 'server',
  ...over,
});

describe('mergeSignups', () => {
  it('adds signups that only exist on the server', () => {
    const out = mergeSignups([], [server({ id: '1', name: 'Ana', checked_in: false })]);
    expect(out).toEqual([{ id: '1', name: 'Ana', email: undefined, phone_number: undefined, product_name: undefined, checked_in: false, checked_in_at: undefined, source: 'server' }]);
  });

  it('takes server data but keeps a local check-in and its time', () => {
    const out = mergeSignups(
      [local({ id: '1', name: 'old', checked_in: true, checked_in_at: '2026-09-12T08:00:00.000Z', printed_at: 'p' })],
      [server({ id: '1', name: 'Ana Souza', email: 'a@x.io', checked_in: false })],
    );
    expect(out[0]).toMatchObject({ name: 'Ana Souza', email: 'a@x.io', checked_in: true, checked_in_at: '2026-09-12T08:00:00.000Z', printed_at: 'p' });
  });

  it('takes the server check-in when the local one is not checked in', () => {
    const out = mergeSignups(
      [local({ id: '1', checked_in: false })],
      [server({ id: '1', checked_in: true, checked_in_at: '2026-09-12T09:00:00.000Z' })],
    );
    expect(out[0]).toMatchObject({ checked_in: true, checked_in_at: '2026-09-12T09:00:00.000Z' });
  });

  it('drops server signups that disappeared, keeps unresolved walk-ins', () => {
    const out = mergeSignups(
      [local({ id: 'gone' }), local({ id: 'local:abc', source: 'walkin', name: 'Walk In' })],
      [server({ id: '2' })],
    );
    expect(out.map((s) => s.id)).toEqual(['2', 'local:abc']);
  });

  it('keeps server order', () => {
    const out = mergeSignups([], [server({ id: 'b' }), server({ id: 'a' })]);
    expect(out.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('normalize / matchesSearch', () => {
  it('strips accents and case', () => {
    expect(normalize('  José Ção ')).toBe('jose cao');
  });

  it('matches on name or email, empty query matches everything', () => {
    const s = local({ id: '1', name: 'José Ção', email: 'jose@x.io' });
    expect(matchesSearch(s, 'cao')).toBe(true);
    expect(matchesSearch(s, 'JOSE@')).toBe(true);
    expect(matchesSearch(s, 'maria')).toBe(false);
    expect(matchesSearch(s, '')).toBe(true);
  });
});
