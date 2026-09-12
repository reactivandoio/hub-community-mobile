import { decodeToken, isTokenExpired } from '../jwt';

// Unsigned JWT with the given payload — signature is never verified client-side.
const createJWT = (payload: Record<string, unknown>): string =>
  `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify(payload))}.sig`;

const NOW_SECONDS = 1_750_000_000;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW_SECONDS * 1000);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('decodeToken', () => {
  it('decodes the payload of a valid JWT', () => {
    expect(decodeToken(createJWT({ sub: 'u1', exp: 42 }))).toEqual({ sub: 'u1', exp: 42 });
  });

  it('returns null for malformed input', () => {
    expect(decodeToken('not.a.jwt')).toBeNull();
    expect(decodeToken('')).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('is false while exp is in the future', () => {
    expect(isTokenExpired(createJWT({ exp: NOW_SECONDS + 3600 }))).toBe(false);
  });

  it('is true once exp has passed', () => {
    expect(isTokenExpired(createJWT({ exp: NOW_SECONDS - 1 }))).toBe(true);
  });

  it('treats tokens without exp or undecodable tokens as expired', () => {
    expect(isTokenExpired(createJWT({ sub: 'u1' }))).toBe(true);
    expect(isTokenExpired('garbage')).toBe(true);
  });
});
