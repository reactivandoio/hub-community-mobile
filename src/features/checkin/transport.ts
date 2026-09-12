import type { ServerSignup, WalkinInput } from './types';

export interface MutationResult {
  success: boolean;
  message?: string | null;
  signup?: ServerSignup | null;
}

/** Everything the sync layer needs from the BFF. Implemented over Apollo in apollo-transport.ts. */
export interface CheckinTransport {
  fetchSignups(eventSlug: string): Promise<ServerSignup[]>;
  checkin(eventSlug: string, signupId: string, checkedInAt: string): Promise<MutationResult>;
  walkin(eventSlug: string, batchId: string, input: WalkinInput): Promise<MutationResult>;
}

/** Thrown when the request never reached the BFF (offline, timeout, DNS). Retried with backoff. */
export class NetworkError extends Error {
  name = 'NetworkError';
}
