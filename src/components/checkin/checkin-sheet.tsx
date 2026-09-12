import { useState } from 'react';
import { Button, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocalSignup } from '@/features/checkin/types';

export interface CheckinSheetProps {
  signup: LocalSignup | null;
  printerReady: boolean;
  /** A printer is attached but lacks USB permission (vs. none attached). */
  permissionDenied?: boolean;
  printing: boolean;
  onPrintAndCheckin(signup: LocalSignup): Promise<void>;
  onCheckinOnly(signup: LocalSignup): void;
  onReprint(signup: LocalSignup): Promise<void>;
  onClose(): void;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const NO_PERMISSION_MESSAGE = 'Impressora sem permissão — toque em Selecionar nas configurações';
export const NO_PRINTER_MESSAGE = 'Sem impressora selecionada';

export function CheckinSheet({ signup, printerReady, permissionDenied = false, printing, onPrintAndCheckin, onCheckinOnly, onReprint, onClose }: CheckinSheetProps) {
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    onClose();
  };
  const attempt = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal visible={signup != null} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      {signup ? (
        <View style={styles.sheet}>
          <Text style={styles.name}>{signup.name}</Text>
          <Text style={styles.meta}>{[signup.email, signup.product_name].filter(Boolean).join(' · ')}</Text>
          {signup.checked_in ? (
            <>
              <Text style={styles.done}>Credenciado às {signup.checked_in_at ? hhmm(signup.checked_in_at) : '--:--'}</Text>
              <Button title="Reimprimir" disabled={!printerReady || printing} onPress={() => void attempt(() => onReprint(signup))} />
            </>
          ) : (
            <>
              <Button title={printing ? 'Imprimindo...' : 'Imprimir e credenciar'} disabled={!printerReady || printing} onPress={() => void attempt(() => onPrintAndCheckin(signup))} />
              {error || !printerReady ? (
                <Button title="Credenciar sem imprimir" onPress={() => { onCheckinOnly(signup); close(); }} />
              ) : null}
            </>
          )}
          {!printerReady ? <Text style={styles.warn}>{permissionDenied ? NO_PERMISSION_MESSAGE : NO_PRINTER_MESSAGE}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Fechar" color="#888" onPress={close} />
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#fff', padding: 20, gap: 10, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  name: { fontSize: 24, fontWeight: '800' },
  meta: { color: '#666' },
  done: { color: '#065f46', fontWeight: '600' },
  warn: { color: '#92400e' },
  error: { color: '#991b1b' },
});
