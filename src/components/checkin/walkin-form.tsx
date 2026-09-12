import { useRef, useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { normalize } from '@/features/checkin/merge';
import { useCheckinStore, useEventCache } from '@/features/checkin/store-provider';
import { getPrinterStorage, usePrinter, type PrinterState } from '@/features/printer/use-printer';
import { readLabelPrefs } from '@/features/printer/printer-prefs';
import { usePrintBadge, type BadgeData } from '@/features/printer/use-print-badge';

interface Props {
  slug: string;
  printer?: PrinterState;
  printBadge?: (data: BadgeData) => Promise<void>;
  onDone(signupId: string): void;
}

const EMAIL = /^\S+@\S+\.\S+$/;

export function WalkinForm({ slug, printer: printerOverride, printBadge: printOverride, onDone }: Props) {
  const store = useCheckinStore();
  const event = useEventCache(slug);
  const ownPrinter = usePrinter();
  const printer = printerOverride ?? ownPrinter;
  const ownPrint = usePrintBadge({ deviceName: printer.selected?.deviceName ?? null, label: readLabelPrefs(getPrinterStorage()) });
  const print = printOverride ?? ownPrint.print;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [savedWithoutBadge, setSavedWithoutBadge] = useState<{ id: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` (state) only disables the button after React commits a re-render,
  // so two `onPress` calls arriving in the same tick would both pass the
  // `disabled` guard. This ref is the actual re-entrancy mutex, checked and
  // set synchronously before any store mutation (same pattern as
  // `use-print-badge.tsx`'s `inFlight` ref).
  const submitting = useRef(false);

  if (!event) return <Text style={styles.error}>Evento não carregado.</Text>;
  const noBatch = !event.settings.batchId;

  const submit = async () => {
    if (submitting.current) return;
    setError(null);
    setExistingId(null);
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName) return setError('Informe o nome');
    if (!EMAIL.test(cleanEmail)) return setError('E-mail inválido');
    const existing = event.signups.find((s) => normalize(s.email ?? '') === normalize(cleanEmail));
    if (existing) {
      setExistingId(existing.id);
      return setError('Este e-mail já está inscrito');
    }
    submitting.current = true;
    setBusy(true);
    const created = store.addWalkin(slug, { name: cleanName, email: cleanEmail, phone_number: phone.trim() || undefined });
    try {
      await print({ fullName: created.name, logoText: event.settings.logoText, link: event.settings.link });
      store.checkIn(slug, created.id);
      store.markPrinted(slug, created.id);
      onDone(created.id);
    } catch (e) {
      store.checkIn(slug, created.id);
      setSavedWithoutBadge({ id: created.id, message: (e as Error).message });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (savedWithoutBadge) {
    return (
      <View style={styles.form}>
        <Text style={styles.warn}>Inscrição salva; crachá não impresso: {savedWithoutBadge.message}</Text>
        <Button title="Concluir" onPress={() => onDone(savedWithoutBadge.id)} />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      {ownPrint.offscreen}
      {noBatch ? <Text style={styles.warn}>Selecione o lote nas configurações antes de inscrever</Text> : null}
      <TextInput style={styles.input} placeholder="Nome completo" value={name} onChangeText={setName} autoCapitalize="words" />
      <TextInput style={styles.input} placeholder="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
      <TextInput style={styles.input} placeholder="Telefone (opcional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {existingId ? <Button title="Ir para o check-in" onPress={() => onDone(existingId)} /> : null}
      <Button title={busy ? 'Imprimindo...' : 'Imprimir e inscrever'} disabled={busy || noBatch} onPress={() => void submit()} />
      {!printer.ready ? <Text style={styles.warn}>Sem impressora selecionada — a inscrição será salva sem crachá</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
  error: { color: '#991b1b' },
  warn: { color: '#92400e' },
});
