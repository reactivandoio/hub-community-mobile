import { useMutation } from '@apollo/client';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { isEmail, loginError, normalizeCode, normalizeEmail } from '@/features/auth/login-errors';
import { REQUEST_LOGIN_CODE, VERIFY_LOGIN_CODE } from '@/lib/queries';
import type { RequestLoginCodeResponse, VerifyLoginCodeResponse } from '@/lib/types';

/**
 * REA-26/REA-58: there is no password. The person types the e-mail, gets a 6-digit code and
 * types it back. A new e-mail gets its account at that moment (same as the web); completing the
 * profile is still done on the site.
 */
export function LoginScreen() {
  const { session, signIn } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [requestCode, { loading: requesting }] = useMutation<RequestLoginCodeResponse>(REQUEST_LOGIN_CODE);
  const [verifyCode, { loading: verifying }] = useMutation<VerifyLoginCodeResponse>(VERIFY_LOGIN_CODE);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const sendCode = async () => {
    if (!isEmail(email)) {
      setError('Digite um e-mail válido.');
      return;
    }
    setError(null);
    try {
      const { data } = await requestCode({ variables: { email: normalizeEmail(email) } });
      setResendIn(data?.requestLoginCode.resendIn ?? 60);
      setCode('');
      setStep('code');
    } catch (e) {
      const err = loginError(e, 'Não foi possível enviar o código. Tente de novo.');
      if (err.retryAfter) setResendIn(err.retryAfter);
      // A code sent a moment ago is still valid: let the person type it.
      if (err.code === 'LOGIN_CODE_COOLDOWN') setStep('code');
      setError(err.message);
    }
  };

  const confirm = async () => {
    const digits = normalizeCode(code);
    if (digits.length !== 6) {
      setError('O código tem 6 números.');
      return;
    }
    setError(null);
    try {
      const { data } = await verifyCode({ variables: { email: normalizeEmail(email), code: digits } });
      const user = data?.verifyLoginCode;
      if (!user?.token) throw new Error('sem token');
      await signIn(user.token, {
        id: user.id,
        email: user.email || normalizeEmail(email),
        name: user.name,
        username: user.username,
      });
    } catch (e) {
      setError(loginError(e, 'Não foi possível entrar. Tente de novo.').message);
    }
  };

  const expired = session.status === 'signedOut' && session.reason === 'expired';

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>Entrar no HubCommunity</Text>
        {expired && step === 'email' ? <Text style={styles.notice}>Sua sessão expirou. Entre de novo.</Text> : null}

        {step === 'email' ? (
          <>
            <Text style={styles.help}>Enviaremos um código de 6 números para o seu e-mail. Não há senha.</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="seu@email.com"
              accessibilityLabel="E-mail"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={() => void sendCode()}
            />
            <PrimaryButton title="Receber código" busy={requesting} onPress={() => void sendCode()} />
          </>
        ) : (
          <>
            <Text style={styles.help}>
              Digite o código enviado para <Text style={styles.bold}>{normalizeEmail(email)}</Text>. Ele vale por 10
              minutos.
            </Text>
            <TextInput
              style={[styles.input, styles.code]}
              value={code}
              onChangeText={(t) => setCode(normalizeCode(t))}
              placeholder="000000"
              accessibilityLabel="Código"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={() => void confirm()}
            />
            <PrimaryButton title="Entrar" busy={verifying} onPress={() => void confirm()} />
            <View style={styles.links}>
              <Pressable
                onPress={() => void sendCode()}
                disabled={resendIn > 0 || requesting}
                accessibilityRole="button"
              >
                <Text style={[styles.link, (resendIn > 0 || requesting) && styles.disabled]}>
                  {resendIn > 0 ? `Reenviar em ${resendIn}s` : 'Reenviar código'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setStep('email');
                  setError(null);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.link}>Trocar e-mail</Text>
              </Pressable>
            </View>
          </>
        )}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function PrimaryButton({ title, busy, onPress }: { title: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.button, busy && styles.disabled]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: '#f4f4f5' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  help: { fontSize: 15, color: '#444' },
  bold: { fontWeight: '700' },
  notice: { fontSize: 14, color: '#92400e', backgroundColor: '#fef3c7', padding: 8, borderRadius: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 17 },
  code: { fontSize: 26, letterSpacing: 8, textAlign: 'center' },
  button: { backgroundColor: '#10B981', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: '#047857', fontSize: 15, paddingVertical: 6 },
  disabled: { opacity: 0.5 },
  error: { color: '#b00020', fontSize: 15 },
});
