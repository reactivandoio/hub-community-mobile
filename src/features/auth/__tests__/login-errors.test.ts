import { ApolloError } from '@apollo/client';
import { GraphQLError } from 'graphql';
import { isEmail, loginError, normalizeCode, normalizeEmail } from '../login-errors';

describe('loginError', () => {
  it("keeps the BFF's message, code and retryAfter", () => {
    const error = new ApolloError({
      graphQLErrors: [new GraphQLError('Aguarde 42 segundos.', { extensions: { code: 'LOGIN_CODE_COOLDOWN', retryAfter: 42 } })],
    });
    expect(loginError(error, 'x')).toEqual({ message: 'Aguarde 42 segundos.', code: 'LOGIN_CODE_COOLDOWN', retryAfter: 42 });
  });

  it('says it is the connection on a network error', () => {
    expect(loginError(new ApolloError({ networkError: new Error('Network request failed') }), 'x').message).toMatch(/conexão/);
  });

  it('falls back for anything else', () => {
    expect(loginError(new Error('boom'), 'Tente de novo.')).toEqual({ message: 'Tente de novo.' });
  });
});

describe('normalizers', () => {
  it('trims and lowercases the e-mail, and validates it', () => {
    expect(normalizeEmail('  Ana@X.io ')).toBe('ana@x.io');
    expect(isEmail('ana@x.io')).toBe(true);
    expect(isEmail('ana@')).toBe(false);
  });

  it('keeps only 6 digits of a pasted code', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('12-34-56-78')).toBe('123456');
  });
});
