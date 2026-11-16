import React from 'react';
import { MockedProvider, type MockedResponse } from '@apollo/client/testing';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GraphQLError } from 'graphql';
import { REQUEST_LOGIN_CODE, VERIFY_LOGIN_CODE } from '@/lib/queries';
import { LoginScreen } from '../login-screen';

const mockSignIn = jest.fn().mockResolvedValue(undefined);
let mockSession: { status: string; reason?: string } = { status: 'signedOut' };
jest.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: mockSession, signIn: mockSignIn }),
}));

const requestOk: MockedResponse = {
  request: { query: REQUEST_LOGIN_CODE, variables: { email: 'ana@x.io' } },
  result: { data: { requestLoginCode: { __typename: 'LoginCodeRequest', sent: true, resendIn: 60 } } },
};
const verifyOk: MockedResponse = {
  request: { query: VERIFY_LOGIN_CODE, variables: { email: 'ana@x.io', code: '123456' } },
  result: {
    data: { verifyLoginCode: { __typename: 'User', id: '7', token: 'tok', email: 'ana@x.io', username: 'ana', name: 'Ana Lima' } },
  },
};

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

const renderLogin = (mocks: MockedResponse[]) =>
  render(
    <MockedProvider mocks={mocks}>
      <LoginScreen />
    </MockedProvider>,
  );

describe('LoginScreen (login only by code, REA-26)', () => {
  beforeEach(() => {
    mockSignIn.mockClear();
    mockSession = { status: 'signedOut' };
  });

  it('has no password field', async () => {
    await renderLogin([]);
    const inputs = screen.queryAllByPlaceholderText(/./);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].props.secureTextEntry).toBeFalsy();
    expect(screen.queryByLabelText(/senha/i)).toBeNull();
  });

  it('sends the code to the normalized e-mail and signs in with the code', async () => {
    await renderLogin([requestOk, verifyOk]);
    await fireEvent.changeText(screen.getByLabelText('E-mail'), '  Ana@X.io ');
    await fireEvent.press(screen.getByLabelText('Receber código'));
    await flush();
    expect(screen.getByText(/ana@x\.io/)).toBeTruthy();
    expect(screen.getByText('Reenviar em 60s')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Código'), '123 456');
    await fireEvent.press(screen.getByLabelText('Entrar'));
    await flush();
    expect(mockSignIn).toHaveBeenCalledWith('tok', { id: '7', email: 'ana@x.io', name: 'Ana Lima', username: 'ana' });
  });

  it('refuses an invalid e-mail without calling the BFF', async () => {
    await renderLogin([]);
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'ana@');
    await fireEvent.press(screen.getByLabelText('Receber código'));
    expect(screen.getByText('Digite um e-mail válido.')).toBeTruthy();
  });

  it("shows the BFF's message for a wrong code and does not sign in", async () => {
    const wrong: MockedResponse = {
      request: { query: VERIFY_LOGIN_CODE, variables: { email: 'ana@x.io', code: '000000' } },
      result: { errors: [new GraphQLError('Código incorreto. Você tem mais 4 tentativas.', { extensions: { code: 'LOGIN_CODE_INVALID', attemptsLeft: 4 } })] },
    };
    await renderLogin([requestOk, wrong]);
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'ana@x.io');
    await fireEvent.press(screen.getByLabelText('Receber código'));
    await flush();
    await fireEvent.changeText(screen.getByLabelText('Código'), '000000');
    await fireEvent.press(screen.getByLabelText('Entrar'));
    await flush();
    expect(screen.getByText('Código incorreto. Você tem mais 4 tentativas.')).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('goes to the code step on cooldown (a code was just sent) and counts down', async () => {
    const cooldown: MockedResponse = {
      request: { query: REQUEST_LOGIN_CODE, variables: { email: 'ana@x.io' } },
      result: { errors: [new GraphQLError('Aguarde 30 segundos para pedir outro código.', { extensions: { code: 'LOGIN_CODE_COOLDOWN', retryAfter: 30 } })] },
    };
    await renderLogin([cooldown]);
    await fireEvent.changeText(screen.getByLabelText('E-mail'), 'ana@x.io');
    await fireEvent.press(screen.getByLabelText('Receber código'));
    await flush();
    expect(screen.getByLabelText('Código')).toBeTruthy();
    expect(screen.getByText('Reenviar em 30s')).toBeTruthy();
    expect(screen.getByText('Aguarde 30 segundos para pedir outro código.')).toBeTruthy();
  });

  it('says the session expired', async () => {
    mockSession = { status: 'signedOut', reason: 'expired' };
    await renderLogin([]);
    expect(screen.getByText('Sua sessão expirou. Entre de novo.')).toBeTruthy();
  });
});
