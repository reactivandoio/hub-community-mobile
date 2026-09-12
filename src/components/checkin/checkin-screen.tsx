import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { matchesSearch } from '@/features/checkin/merge';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import type { SyncEngine } from '@/features/checkin/sync';
import type { LocalSignup } from '@/features/checkin/types';
import { useEventSync } from '@/features/checkin/use-sync';
import { readLabelPrefs } from '@/features/printer/printer-prefs';
import { usePrintBadge, type BadgeData } from '@/features/printer/use-print-badge';
import { usePrinter, getPrinterStorage, type PrinterState } from '@/features/printer/use-printer';
import { CheckinSheet } from './checkin-sheet';
import { SignupRow } from './signup-row';
import { StatusBar } from './status-bar';

interface Props {
  slug: string;
  engine?: SyncEngine;
  printer?: PrinterState;
  printBadge?: (data: BadgeData) => Promise<void>;
}

export function CheckinScreen({ slug, engine, printer: printerOverride, printBadge: printOverride }: Props) {
  const store = useCheckinStore();
  const event = useEventCache(slug);
  const sync = useEventSync(slug, engine);
  const router = useRouter();
  const ownPrinter = usePrinter();
  const printer = printerOverride ?? ownPrinter;
  const label = useMemo(() => readLabelPrefs(getPrinterStorage()), []);
  const ownPrint = usePrintBadge({ deviceName: printer.selected?.deviceName ?? null, label });
  const print = printOverride ?? ownPrint.print;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LocalSignup | null>(null);

  if (!event) {
    return (
      <View style={styles.center}>
        <Text>Evento não carregado.</Text>
        <Button title="Voltar" onPress={() => router.back()} />
      </View>
    );
  }

  const badge = (s: LocalSignup): BadgeData => ({ fullName: s.name, logoText: event.settings.logoText, link: event.settings.link });
  const visible = event.signups.filter((s) => matchesSearch(s, query));
  const pending = event.outbox.filter((i) => !i.failed).length;
  const failed = event.outbox.filter((i) => i.failed).length;

  return (
    <View style={styles.screen}>
      {ownPrint.offscreen}
      <StatusBar
        online={sync.online}
        syncing={sync.syncing}
        pending={pending}
        failed={failed}
        lastSyncAt={sync.lastSyncAt}
        lastError={sync.lastError}
        printerReady={printer.ready}
        onSync={() => void sync.syncNow()}
      />
      <View style={styles.toolbar}>
        <TextInput style={styles.search} placeholder="Buscar por nome ou e-mail" value={query} onChangeText={setQuery} autoCorrect={false} />
        <View style={styles.toolbarButtons}>
          <View style={styles.toolbarButton}>
            <Button title="Inscrever na hora" onPress={() => router.push(`/checkin/${slug}/walkin` as Href)} />
          </View>
          <View style={styles.toolbarButton}>
            <Button title="Config." color="#888" onPress={() => router.push(`/checkin/${slug}/settings` as Href)} />
          </View>
        </View>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <SignupRow signup={item} onPress={() => setSelected(item)} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>Nenhum inscrito encontrado.</Text>}
      />
      <CheckinSheet
        signup={selected}
        printerReady={printer.ready}
        printing={ownPrint.printing}
        onPrintAndCheckin={async (s) => {
          await print(badge(s));
          store.checkIn(slug, s.id);
          store.markPrinted(slug, s.id);
        }}
        onCheckinOnly={(s) => store.checkIn(slug, s.id)}
        onReprint={async (s) => {
          await print(badge(s));
          store.markPrinted(slug, s.id);
        }}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  toolbar: { gap: 8, padding: 12 },
  toolbarButtons: { flexDirection: 'row', gap: 8 },
  toolbarButton: { flex: 1 },
  search: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  empty: { textAlign: 'center', color: '#666', padding: 24 },
});
