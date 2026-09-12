import { useQuery } from '@apollo/client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import { readLabelPrefs, writeLabelPrefs, type LabelPrefs } from '@/features/printer/printer-prefs';
import { getPrinterStorage, usePrinter, type PrinterState } from '@/features/printer/use-printer';
import { EVENT_BATCHES } from '@/lib/queries';
import type { EventBatchesResponse } from '@/lib/types';

const money = (v: number) => (v > 0 ? `R$ ${v.toFixed(2).replace('.', ',')}` : 'grátis');

export function EventSettingsScreen({ slug, printer: printerOverride }: { slug: string; printer?: PrinterState }) {
  const store = useCheckinStore();
  const event = useEventCache(slug);
  const router = useRouter();
  const ownPrinter = usePrinter();
  const printer = printerOverride ?? ownPrinter;
  const { data } = useQuery<EventBatchesResponse>(EVENT_BATCHES, { variables: { slugOrId: slug }, fetchPolicy: 'cache-and-network' });
  const [label, setLabel] = useState<LabelPrefs>(() => readLabelPrefs(getPrinterStorage()));
  const [gapText, setGapText] = useState(() => String(label.gapMm));
  const [densityText, setDensityText] = useState(() => String(label.density));

  if (!event) return <Text style={styles.warn}>Evento não carregado.</Text>;
  const failed = event.outbox.filter((i) => i.failed);
  const batches = (data?.eventBySlugOrId?.products ?? [])
    .filter((p) => p.enabled !== false)
    .flatMap((p) => (p.batches ?? []).filter((b) => b.enabled !== false).map((b) => ({ id: String(b.id), label: `${p.name} · Lote ${b.batch_number} (${money(b.value ?? 0)})` })));

  const updateLabel = (patch: Partial<LabelPrefs>) => {
    const next = { ...label, ...patch };
    setLabel(next);
    writeLabelPrefs(getPrinterStorage(), next);
  };

  const commitGap = () => {
    const parsed = Number(gapText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setGapText(String(label.gapMm));
      return;
    }
    updateLabel({ gapMm: parsed });
    setGapText(String(parsed));
  };

  const commitDensity = () => {
    const parsed = Number(densityText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDensityText(String(label.density));
      return;
    }
    updateLabel({ density: parsed });
    setDensityText(String(parsed));
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.h}>Crachá</Text>
      <TextInput style={styles.input} placeholder="Texto do logo" value={event.settings.logoText} onChangeText={(logoText) => store.updateSettings(slug, { logoText })} />
      <TextInput style={styles.input} placeholder="Link do QR" value={event.settings.link} autoCapitalize="none" onChangeText={(link) => store.updateSettings(slug, { link })} />

      <Text style={styles.h}>Lote para inscrição na hora</Text>
      {batches.length === 0 ? <Text style={styles.meta}>Nenhum lote habilitado (ou sem conexão para listar).</Text> : null}
      {batches.map((b) => (
        <Pressable key={b.id} onPress={() => store.updateSettings(slug, { batchId: b.id })} style={[styles.option, event.settings.batchId === b.id && styles.optionSelected]}>
          <Text>{b.label}</Text>
        </Pressable>
      ))}

      <Text style={styles.h}>Impressora USB</Text>
      {!printer.available ? <Text style={styles.warn}>Impressão USB só funciona no Android.</Text> : null}
      {printer.devices.length === 0 ? <Text style={styles.meta}>Nenhuma impressora conectada.</Text> : null}
      {printer.devices.map((d) => {
        const isSelected = printer.selected?.deviceName === d.deviceName;
        return (
          <View key={d.deviceName} style={styles.deviceRow}>
            <Text style={styles.deviceName}>
              {d.productName ?? d.deviceName} {isSelected ? (d.hasPermission ? '✓ selecionada' : '(sem permissão)') : ''}
            </Text>
            <Button title="Selecionar" onPress={() => void printer.select(d)} />
          </View>
        );
      })}
      <View style={styles.row}>
        <Text style={styles.meta}>Gap (mm)</Text>
        <TextInput
          style={styles.small}
          keyboardType="numeric"
          accessibilityLabel="Gap (mm)"
          value={gapText}
          onChangeText={setGapText}
          onBlur={commitGap}
        />
        <Text style={styles.meta}>Densidade</Text>
        <TextInput
          style={styles.small}
          keyboardType="numeric"
          accessibilityLabel="Densidade"
          value={densityText}
          onChangeText={setDensityText}
          onBlur={commitDensity}
        />
      </View>

      <Text style={styles.h}>Pendências com erro ({failed.length})</Text>
      {failed.map((item) => (
        <View key={item.id} style={styles.failed}>
          <Text>{item.kind === 'walkin' ? `Inscrição: ${item.input.name}` : `Check-in: ${item.signupId}`}</Text>
          <Text style={styles.warn}>{item.lastError}</Text>
          <View style={styles.row}>
            <Button title="Tentar de novo" onPress={() => store.retryOutboxItem(slug, item.id)} />
            <Button title="Descartar" color="#991b1b" onPress={() => store.discardOutboxItem(slug, item.id)} />
          </View>
        </View>
      ))}

      <View style={styles.danger}>
        <Button
          title="Remover evento deste aparelho"
          color="#991b1b"
          onPress={() =>
            Alert.alert('Remover evento', event.outbox.length > 0 ? `Há ${event.outbox.length} operação(ões) não sincronizada(s). Remover mesmo assim?` : 'Remover os dados deste evento do aparelho?', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Remover', style: 'destructive', onPress: () => { store.removeEvent(slug); router.replace('/'); } },
            ])
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 8 },
  h: { fontWeight: '700', marginTop: 16 },
  meta: { color: '#666' },
  warn: { color: '#92400e' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  small: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, width: 64 },
  option: { padding: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 8 },
  optionSelected: { borderColor: '#10B981', backgroundColor: '#d1fae5' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deviceName: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  failed: { borderWidth: 1, borderColor: '#fca5a5', borderRadius: 8, padding: 10, gap: 4 },
  danger: { marginTop: 32 },
});
