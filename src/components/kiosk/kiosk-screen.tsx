import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { matchesSearch } from '@/features/checkin/merge';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import type { SyncEngine } from '@/features/checkin/sync';
import { signupUrlFor } from '@/features/checkin/ticket';
import type { LocalSignup } from '@/features/checkin/types';
import { useEventSync } from '@/features/checkin/use-sync';
import { useKioskFlow } from '@/features/kiosk/use-kiosk-flow';
import { readLabelPrefs } from '@/features/printer/printer-prefs';
import { usePrintBadge, type BadgeData } from '@/features/printer/use-print-badge';
import { getPrinterStorage, usePrinter, type PrinterState } from '@/features/printer/use-printer';
import { KioskOverlay } from './kiosk-overlay';

interface Props {
  slug: string;
  engine?: SyncEngine;
  printer?: PrinterState;
  printBadge?: (data: BadgeData) => Promise<void>;
  resetAfterMs?: number;
}

/** The kiosk polls faster than the operator screen: "I just signed up" → "my name shows up" is felt by the attendee. */
export const KIOSK_PULL_INTERVAL_MS = 15_000;
const MAX_RESULTS = 8;
const MIN_QUERY = 2;

export function KioskScreen({ slug, engine, printer: printerOverride, printBadge: printOverride, resetAfterMs }: Props) {
  useKeepAwake();
  const store = useCheckinStore();
  const event = useEventCache(slug);
  const sync = useEventSync(slug, engine, { pullIntervalMs: KIOSK_PULL_INTERVAL_MS });
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const ownPrinter = usePrinter();
  const printer = printerOverride ?? ownPrinter;
  const ownPrint = usePrintBadge({ deviceName: printer.selected?.deviceName ?? null, label: currentLabel });
  const print = printOverride ?? ownPrint.print;
  const [permission, requestPermission] = useCameraPermissions();
  const [query, setQuery] = useState('');

  const flow = useKioskFlow({
    findSignup: (id) => store.getEvent(slug)?.signups.find((s) => s.id === id),
    badge: (s) => ({ fullName: s.name, logoText: event?.settings.logoText ?? '', link: event?.settings.link ?? '' }),
    printerReady: printer.ready,
    print,
    checkIn: (id) => store.checkIn(slug, id),
    markPrinted: (id) => store.markPrinted(slug, id),
    syncNow: sync.syncNow,
    resetAfterMs,
  });

  if (!event) {
    return (
      <View style={styles.center}>
        <Text>Evento não carregado.</Text>
        <Button title="Voltar" onPress={() => router.back()} />
      </View>
    );
  }

  const trimmed = query.trim();
  const results = trimmed.length >= MIN_QUERY ? event.signups.filter((s) => matchesSearch(s, trimmed)).slice(0, MAX_RESULTS) : [];
  const idle = flow.state.kind === 'idle';

  const pick = (s: LocalSignup) => {
    flow.select(s);
    setQuery('');
  };
  const onScan = ({ data }: BarcodeScanningResult) => flow.scan(data);
  const confirmExit = () =>
    Alert.alert('Sair do modo totem?', 'A tela do operador volta a aparecer.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => router.back() },
    ]);

  return (
    <View style={styles.screen}>
      {ownPrint.offscreen}
      <View style={styles.header}>
        {/* Hidden exit: hold the top-left corner for two seconds. */}
        <Pressable accessibilityLabel="Sair do modo totem" onLongPress={confirmExit} delayLongPress={2000} style={styles.exitZone} />
        <Text style={styles.title} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={styles.subtitle}>Credenciamento</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.body, landscape && styles.bodyRow]} keyboardShouldPersistTaps="handled">
        <View style={[styles.column, landscape && styles.columnMain]}>
          <View style={styles.card}>
            <Text style={styles.h}>Aproxime o QR code da sua inscrição</Text>
            <View style={styles.cameraFrame}>
              {permission?.granted ? (
                <CameraView
                  style={styles.camera}
                  facing="front"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={idle ? onScan : undefined}
                />
              ) : (
                <View style={styles.cameraOff}>
                  <Text style={styles.cameraOffText}>Câmera desligada</Text>
                  <Button title="Permitir câmera" onPress={() => void requestPermission()} />
                </View>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.h}>Ou digite seu nome</Text>
            <TextInput
              style={styles.search}
              placeholder="Seu nome"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="words"
              editable={idle}
            />
            {results.map((s) => (
              <Pressable key={s.id} onPress={() => pick(s)} style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}>
                <Text style={styles.resultName}>{s.name}</Text>
                <Text style={styles.resultMeta}>{[maskEmail(s.email), s.product_name].filter(Boolean).join(' · ')}</Text>
              </Pressable>
            ))}
            {trimmed.length >= MIN_QUERY && results.length === 0 ? <Text style={styles.empty}>Nenhum inscrito com esse nome.</Text> : null}
            {trimmed.length >= MIN_QUERY ? (
              <Pressable onPress={() => void sync.syncNow()} disabled={sync.syncing} style={styles.refresh}>
                <Text style={styles.refreshText}>{sync.syncing ? 'Atualizando…' : 'Não achou seu nome? Toque para atualizar'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={[styles.column, landscape && styles.columnSide]}>
          <View style={[styles.card, styles.signupCard]}>
            <Text style={styles.h}>Ainda não se inscreveu?</Text>
            <Text style={styles.p}>Escaneie com seu celular, faça a inscrição e volte aqui para retirar seu crachá.</Text>
            <View style={styles.qr}>
              <QRCode value={signupUrlFor(event)} size={landscape ? 220 : 180} ecl="M" />
            </View>
          </View>
        </View>
      </ScrollView>

      <KioskOverlay
        state={flow.state}
        printerReady={printer.ready}
        onConfirm={flow.confirm}
        onCancel={flow.cancel}
        onReprint={flow.reprint}
        onNext={flow.next}
      />
    </View>
  );
}

/** `jo***@gmail.com` — enough to tell two people with the same name apart on a public screen. */
export function maskEmail(email?: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return null;
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${email.slice(at)}`;
}

// Read at print time so settings edits apply to the next badge (see CheckinScreen).
const currentLabel = () => readLabelPrefs(getPrinterStorage());

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f5' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { paddingTop: 48, paddingBottom: 16, paddingHorizontal: 24, backgroundColor: '#208AEF' },
  exitZone: { position: 'absolute', top: 0, left: 0, width: 96, height: 96 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#dbeafe', fontSize: 16, marginTop: 2 },
  body: { padding: 16, gap: 16 },
  bodyRow: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: 16 },
  columnMain: { flex: 3 },
  columnSide: { flex: 2 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, gap: 12 },
  signupCard: { alignItems: 'center' },
  h: { fontSize: 22, fontWeight: '700' },
  p: { fontSize: 16, color: '#52525b', textAlign: 'center' },
  cameraFrame: { aspectRatio: 4 / 3, borderRadius: 12, overflow: 'hidden', backgroundColor: '#18181b' },
  camera: { flex: 1 },
  cameraOff: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  cameraOffText: { color: '#a1a1aa', fontSize: 16 },
  search: { borderWidth: 1, borderColor: '#d4d4d8', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 20 },
  result: { paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d4d4d8' },
  resultPressed: { backgroundColor: '#f4f4f5' },
  resultName: { fontSize: 20, fontWeight: '600' },
  resultMeta: { fontSize: 14, color: '#71717a', marginTop: 2 },
  empty: { color: '#71717a', fontSize: 16, paddingVertical: 8 },
  refresh: { paddingVertical: 10 },
  refreshText: { color: '#208AEF', fontSize: 16, fontWeight: '600' },
  qr: { backgroundColor: '#fff', padding: 12 },
});
