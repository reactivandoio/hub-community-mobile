import { ActivityIndicator, Button, Modal, StyleSheet, Text, View } from 'react-native';
import type { KioskState } from '@/features/kiosk/use-kiosk-flow';

interface Props {
  state: KioskState;
  printerReady: boolean;
  onConfirm(): void;
  onCancel(): void;
  onReprint(): void;
  onNext(): void;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Full-screen step on top of the kiosk: confirm, wait, welcome or "not found". */
export function KioskOverlay({ state, printerReady, onConfirm, onCancel, onReprint, onNext }: Props) {
  if (state.kind === 'idle') return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onNext}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {state.kind === 'looking_up' ? (
            <>
              <ActivityIndicator size="large" />
              <Text style={styles.h}>Procurando sua inscrição…</Text>
            </>
          ) : null}

          {state.kind === 'confirm' ? (
            <>
              <Text style={styles.eyebrow}>É você?</Text>
              <Text style={styles.name}>{state.signup.name}</Text>
              <View style={styles.actions}>
                <Button title="Sim, sou eu" onPress={onConfirm} />
                <Button title="Não sou eu" color="#71717a" onPress={onCancel} />
              </View>
            </>
          ) : null}

          {state.kind === 'printing' ? (
            <>
              <ActivityIndicator size="large" />
              <Text style={styles.h}>Imprimindo seu crachá…</Text>
            </>
          ) : null}

          {state.kind === 'done' ? (
            <>
              <Text style={styles.eyebrow}>{state.alreadyCheckedIn ? 'Você já fez check-in' : 'Bem-vindo(a),'}</Text>
              <Text style={styles.name}>{firstName(state.signup.name)}!</Text>
              {state.alreadyCheckedIn ? (
                <Text style={styles.p}>Credenciado às {state.signup.checked_in_at ? hhmm(state.signup.checked_in_at) : '--:--'}.</Text>
              ) : null}
              {state.printed ? (
                <Text style={styles.p}>Retire seu crachá na impressora.</Text>
              ) : state.alreadyCheckedIn && !state.error ? null : (
                <Text style={styles.warn}>Retire seu crachá na recepção.</Text>
              )}
              {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
              <View style={styles.actions}>
                {state.alreadyCheckedIn || !state.printed ? (
                  <Button title="Imprimir crachá" disabled={!printerReady} onPress={onReprint} />
                ) : null}
                <Button title="Próximo" color="#71717a" onPress={onNext} />
              </View>
            </>
          ) : null}

          {state.kind === 'not_found' ? (
            <>
              <Text style={styles.h}>Inscrição não encontrada</Text>
              <Text style={styles.p}>Se você acabou de se inscrever, aguarde alguns segundos e tente de novo. Se preferir, procure pelo seu nome ou fale com a recepção.</Text>
              <Button title="Tentar de novo" onPress={onNext} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(24,24,27,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 32, gap: 16, alignItems: 'center', width: '100%', maxWidth: 520 },
  eyebrow: { fontSize: 22, color: '#52525b' },
  name: { fontSize: 40, fontWeight: '800', textAlign: 'center' },
  h: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  p: { fontSize: 18, color: '#52525b', textAlign: 'center' },
  warn: { fontSize: 18, color: '#92400e', textAlign: 'center', fontWeight: '600' },
  error: { fontSize: 14, color: '#991b1b', textAlign: 'center' },
  actions: { gap: 12, alignSelf: 'stretch', marginTop: 8 },
});
