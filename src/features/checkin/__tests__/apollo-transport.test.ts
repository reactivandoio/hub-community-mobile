import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { createApolloTransport } from '../apollo-transport';
import { NetworkError } from '../transport';

const clientWith = (link: ApolloLink) => new ApolloClient({ link, cache: new InMemoryCache({ addTypename: false }) });

describe('createApolloTransport', () => {
  // `addTypename: false` above is deprecated as of Apollo Client 3.14 and
  // logs a console.warn on every ApolloClient construction; it is still the
  // simplest way to keep this suite's mocked link data free of `__typename`.
  // Silence just that warning so test output stays pristine.
  let warnSpy: jest.SpyInstance;
  beforeAll(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('maps eventSignups to ServerSignup[] with network-only fetch', async () => {
    const link = new ApolloLink((op) => {
      expect(op.operationName).toBe('EventSignups');
      expect(op.variables).toEqual({ eventSlug: 'ev' });
      return Observable.of({ data: { eventSignups: [{ id: '1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }] } });
    });
    const out = await createApolloTransport(clientWith(link)).fetchSignups('ev');
    expect(out).toEqual([{ id: '1', name: 'Ana', email: null, phone_number: null, checked_in: false, checked_in_at: null, product_name: null }]);
  });

  it('sends checkin and walkin mutations and returns their payloads', async () => {
    const link = new ApolloLink((op) => {
      if (op.operationName === 'CheckinSignup') {
        expect(op.variables).toEqual({ eventSlug: 'ev', signupId: 's1', checkedInAt: 't' });
        return Observable.of({ data: { checkinSignup: { success: true, message: 'ok', signup: null } } });
      }
      expect(op.variables).toEqual({ eventSlug: 'ev', batchId: '7', input: { name: 'C', email: 'c@x.io', phone_number: '62' } });
      return Observable.of({ data: { manualSignup: { success: true, message: null, account_created: true, signup: { id: 's9', name: 'C' } } } });
    });
    const t = createApolloTransport(clientWith(link));
    expect(await t.checkin('ev', 's1', 't')).toEqual({ success: true, message: 'ok', signup: null });
    expect(await t.walkin('ev', '7', { name: 'C', email: 'c@x.io', phone_number: '62' })).toMatchObject({ success: true, signup: { id: 's9' } });
  });

  it('turns transport failures into NetworkError', async () => {
    const link = new ApolloLink(() => new Observable((o) => o.error(new TypeError('Network request failed'))));
    await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toBeInstanceOf(NetworkError);
  });

  const serverError = (statusCode: number, result: unknown) =>
    Object.assign(new Error(`Received status code ${statusCode}`), { name: 'ServerError', statusCode, result });

  it('treats 5xx and 429 responses with a JSON body as NetworkError (retried with backoff)', async () => {
    for (const status of [500, 502, 503, 429]) {
      const link = new ApolloLink(() => new Observable((o) => o.error(serverError(status, { errors: [{ message: 'upstream down' }] }))));
      await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toBeInstanceOf(NetworkError);
    }
  });

  it('surfaces the GraphQL message of a 4xx ServerError as a plain error', async () => {
    const link = new ApolloLink(() => new Observable((o) => o.error(serverError(400, { errors: [{ message: 'Unknown argument "checkedInAt"' }] }))));
    const err = await createApolloTransport(clientWith(link)).checkin('ev', 's1', 't').catch((e: Error) => e);
    expect(err).not.toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe('Unknown argument "checkedInAt"');
  });

  it('falls back to the status text when a 4xx ServerError has no GraphQL errors', async () => {
    const link = new ApolloLink(() => new Observable((o) => o.error(serverError(404, 'not found'))));
    await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toThrow('Received status code 404');
  });

  it('keeps GraphQL errors as plain errors', async () => {
    const link = new ApolloLink(() => Observable.of({ errors: [{ message: 'Unknown argument' }] } as never));
    await expect(createApolloTransport(clientWith(link)).checkin('ev', 's1', 't')).rejects.toThrow('Unknown argument');
  });
});
