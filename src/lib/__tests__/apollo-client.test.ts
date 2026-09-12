import { ApolloLink, Observable, execute, gql } from '@apollo/client';
import { createAuthLink } from '../apollo-client';

const QUERY = gql`
  query Ping {
    ping
  }
`;

const validToken = () =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`;
const expiredToken = () =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }))}.s`;

// Runs QUERY through authLink and returns the headers the terminating link saw.
const headersSentBy = (authLink: ApolloLink): Promise<Record<string, string> | undefined> =>
  new Promise((resolve, reject) => {
    const terminal = new ApolloLink((operation) => {
      resolve(operation.getContext().headers);
      return Observable.of({ data: { ping: true } });
    });
    execute(ApolloLink.from([authLink, terminal]), { query: QUERY }).subscribe({ error: reject });
  });

describe('createAuthLink', () => {
  it('sends a Bearer header when a valid token is stored', async () => {
    const token = validToken();
    const headers = await headersSentBy(createAuthLink({ getToken: async () => token }));
    expect(headers).toEqual({ authorization: `Bearer ${token}` });
  });

  it('sends no authorization header when there is no token', async () => {
    const headers = await headersSentBy(createAuthLink({ getToken: async () => null }));
    expect(headers?.authorization).toBeUndefined();
  });

  it('drops an expired token instead of sending it', async () => {
    const onExpired = jest.fn();
    const headers = await headersSentBy(
      createAuthLink({ getToken: async () => expiredToken(), onExpired }),
    );
    expect(headers?.authorization).toBeUndefined();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
