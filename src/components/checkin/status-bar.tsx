import { Button, StyleSheet, Text, View } from 'react-native';

export interface StatusBarProps {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSyncAt?: string;
  lastError?: string;
  printerReady: boolean;
  onSync(): void;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function StatusBar({ online, syncing, pending, failed, lastSyncAt, lastError, printerReady, onSync }: StatusBarProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Text style={[styles.pill, online ? styles.ok : styles.bad]}>{online ? 'online' : 'offline'}</Text>
        <Text style={[styles.pill, printerReady ? styles.ok : styles.bad]}>{printerReady ? 'impressora ok' : 'sem impressora'}</Text>
        <Text style={styles.pill}>{pending} pendente{pending === 1 ? '' : 's'}</Text>
        {failed > 0 ? <Text style={[styles.pill, styles.bad]}>{failed} com erro</Text> : null}
      </View>
      <View style={styles.row}>
        <Text style={styles.meta}>{syncing ? 'Sincronizando...' : lastSyncAt ? `Sincronizado às ${hhmm(lastSyncAt)}` : 'Ainda não sincronizado'}</Text>
        {/* Never gated on `online`: the manual button is the operator's way
            out when NetInfo misreports a restricted venue network. */}
        <Button title="Sincronizar agora" onPress={onSync} disabled={syncing} />
      </View>
      {lastError ? <Text style={styles.error}>{lastError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { padding: 12, gap: 6, backgroundColor: '#f4f4f5', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#e4e4e7', overflow: 'hidden' },
  ok: { backgroundColor: '#d1fae5', color: '#065f46' },
  bad: { backgroundColor: '#fee2e2', color: '#991b1b' },
  meta: { flex: 1, fontSize: 12, color: '#555' },
  error: { fontSize: 12, color: '#991b1b' },
});
