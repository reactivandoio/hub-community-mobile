import { ApolloError } from '@apollo/client';

export interface LoginError {
  message: string;
  code?: string;
  /** Seconds before another code can be asked for (LOGIN_CODE_COOLDOWN, LOGIN_CODE_NOT_SENT). */
  retryAfter?: number;
}

/**
 * The BFF answers the login in pt-BR with a code in `extensions` (LOGIN_CODE_COOLDOWN,
 * LOGIN_CODE_INVALID with attemptsLeft, LOGIN_CODE_EXPIRED, ACCOUNT_BLOCKED, RATE_LIMITED…).
 * Its message is already the one to show; same rule as the web's auth modal.
 */
export function loginError(error: unknown, fallback: string): LoginError {
  if (error instanceof ApolloError) {
    const first = error.graphQLErrors?.[0];
    if (first) {
      const ext = (first.extensions ?? {}) as Record<string, unknown>;
      return {
        message: first.message || fallback,
        code: typeof ext.code === 'string' ? ext.code : undefined,
        retryAfter: typeof ext.retryAfter === 'number' ? ext.retryAfter : undefined,
      };
    }
    if (error.networkError) return { message: 'Sem conexão. Verifique a internet e tente de novo.' };
  }
  return { message: fallback };
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

/** The code is 6 digits; whatever else was pasted (spaces, a dash) is dropped. */
export const normalizeCode = (code: string) => code.replace(/\D/g, '').slice(0, 6);
