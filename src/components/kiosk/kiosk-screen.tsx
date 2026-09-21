import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { matchesSearch } from '@/features/checkin/merge';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import type { SyncEngine } from '@/features/checkin/sync';
import { parseTicket, signupUrlFor } from '@/features/checkin/ticket';
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
  const [query, setQuery] = useState('');
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<TextInput>(null);

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
  // The totem's barcode reader behaves as a keyboard: it types what it scans
  // into whatever field has focus. A ticket URL can only have come from it —
  // nobody types `https://…?ticket=…` by hand — so it checks the person in at
  // once. Anything else is a name being typed, and Enter (which the reader
  // sends after a scan) settles the ambiguous case of a bare id.
  const submitTicket = (payload: string) => {
    setQuery('');
    flow.scan(payload);
  };

  const onType = (text: string) => {
    setQuery(text);
    if (/:\/\//.test(text) && parseTicket(text)) submitTicket(text);
  };

  const onSubmit = () => {
    if (parseTicket(query)) submitTicket(query);
  };

  const confirmExit = () =>
    Alert.alert('Sair do modo totem?', 'A tela do operador volta a aparecer.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => router.back() },
    ]);

  return (
    <View style={styles.screen}>
      {ownPrint.offscreen}
      <View style={[styles.body, landscape && styles.bodyRow]}>
        <View style={[styles.column, landscape && styles.columnMain]}>
          {/* Neither input the hardware advertises works here: `expo-camera`
              opens both lenses without error and never renders a frame, and the
              built-in reader does not pick up a QR. Until one of them is
              solved, the totem credentials people by name — so the field is the
              screen, not an afterthought under a dead black rectangle. */}
          <View style={[styles.card, styles.searchCard]}>
            <Text style={styles.h}>Digite seu nome para retirar o crachá</Text>
            <TextInput
              ref={inputRef}
              style={styles.search}
              placeholder="Seu nome"
              value={query}
              onChangeText={onType}
              onSubmitEditing={onSubmit}
              autoCorrect={false}
              autoCapitalize="words"
              blurOnSubmit={false}
              editable={idle}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
            />
            <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
              {results.map((s) => (
                <Pressable key={s.id} onPress={() => pick(s)} style={({ pressed }) => [styles.result, pressed && styles.resultPressed]}>
                  <Text style={styles.resultName}>{s.name}</Text>
                  <Text style={styles.resultMeta}>{[maskEmail(s.email), s.product_name].filter(Boolean).join(' · ')}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {event.signups.length === 0 ? (
              // Silent failure at the door is the worst kind: with an empty
              // cache every search looks like "you are not on the list".
              <Text style={styles.empty}>Nenhum inscrito carregado neste aparelho. Toque em atualizar abaixo.</Text>
            ) : trimmed.length >= MIN_QUERY && results.length === 0 ? (
              <Text style={styles.empty}>Nenhum inscrito com esse nome.</Text>
            ) : null}
            {trimmed.length >= MIN_QUERY || event.signups.length === 0 ? (
              <Pressable onPress={() => void sync.syncNow()} disabled={sync.syncing} style={styles.refresh}>
                <Text style={styles.refreshText}>{sync.syncing ? 'Atualizando…' : 'Não achou seu nome? Toque para atualizar'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {typing ? null : (
        <View style={[styles.column, landscape && styles.columnSide]}>
          {/* Hidden exit: hold this card for two seconds. The whole card is the
              target, not just the QR — a small target plus three seconds asks
              for a steadier finger than a touchscreen gives, and the press
              cancels the moment it slips. Everything inside is
              `pointerEvents="none"` so the SVG cannot swallow the gesture. */}
          <Pressable
            accessibilityLabel="Sair do modo totem"
            onLongPress={confirmExit}
            delayLongPress={2000}
            style={[styles.card, styles.signupCard]}
          >
            <View pointerEvents="none" style={styles.signupInner}>
              <Text style={styles.h}>Ainda não se inscreveu?</Text>
              <Text style={styles.p}>Escaneie com seu celular, faça a inscrição e volte aqui para retirar seu crachá.</Text>
              <View style={styles.qr}>
                <QRCode value={signupUrlFor(event)} size={landscape ? 180 : 140} ecl="M" />
              </View>
            </View>
          </Pressable>
        </View>
        )}
      </View>

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
  // One screen, no scrolling: the body owns the height and hands the leftover
  // to the search card, the only part that grows.
  body: { flex: 1, padding: 16, paddingTop: 24, gap: 12 },
  bodyRow: { flexDirection: 'row', alignItems: 'stretch' },
  column: { flex: 1, gap: 12 },
  columnMain: { flex: 3 },
  columnSide: { flex: 2 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10 },
  searchCard: { flex: 1 },
  results: { flexGrow: 0 },
  signupCard: { alignItems: 'center' },
  signupInner: { alignItems: 'center', gap: 10 },
  h: { fontSize: 22, fontWeight: '700' },
  p: { fontSize: 16, color: '#52525b', textAlign: 'center' },
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
