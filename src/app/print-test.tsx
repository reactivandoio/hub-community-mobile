// SPIKE (throwaway): proves the Android USB OTG -> TSPL path to the 4BARCODE printer.
import { useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { BadgeLabel, BADGE_DOTS } from '@/components/badge-label';
import * as Printer from '../../modules/tspl-usb-printer';

const TEXT_JOB = [
  'SIZE 101.6 mm,50.8 mm',
  'GAP 3 mm,0 mm',
  'CLS',
  'TEXT 40,40,"3",0,2,2,"HUBCOMMUNITY TESTE"',
  'TEXT 40,140,"2",0,1,1,"USB OTG + TSPL OK"',
  'PRINT 1,1',
  '',
].join('\r\n');

export default function PrintTest() {
  const { width } = useWindowDimensions();
  const badgeRef = useRef<View>(null);
  const [devices, setDevices] = useState<Printer.UsbPrinterDevice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('José Ção da Silva Andrade');
  const [gapMm, setGapMm] = useState('3');
  const [log, setLog] = useState<string[]>([]);
  const say = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 30));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const out = await fn();
      say(`${label}: ok ${out === undefined ? '' : JSON.stringify(out)}`);
    } catch (e) {
      say(`${label}: ERRO ${(e as Error).message}`);
    }
  };

  const refresh = () => run('listDevices', async () => {
    const list = Printer.listDevices();
    setDevices(list);
    if (list.length === 1) setSelected(list[0].deviceName);
    return list.map((d) => `${d.manufacturerName ?? '?'} ${d.productName ?? '?'} (${d.vendorId}:${d.productId})`);
  });

  const needDevice = () => {
    if (!selected) throw new Error('nenhuma impressora selecionada');
    return selected;
  };

  const capture = () =>
    captureRef(badgeRef, { format: 'png', quality: 1, result: 'base64', width: BADGE_DOTS.width + 4, height: BADGE_DOTS.height });

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h}>Módulo nativo: {Printer.isAvailable ? 'disponível' : 'INDISPONÍVEL (Expo Go / iOS?)'}</Text>
      <Button title="Buscar impressoras USB" onPress={refresh} />
      {devices.map((d) => (
        <Button
          key={d.deviceName}
          color={d.deviceName === selected ? '#10B981' : undefined}
          title={`${d.productName ?? d.deviceName} ${d.hasPermission ? '✓' : '(sem permissão)'}`}
          onPress={() => setSelected(d.deviceName)}
        />
      ))}
      <Button title="Pedir permissão USB" onPress={() => run('requestPermission', () => Printer.requestPermission(needDevice()))} />
      <Button title="1) Imprimir texto TSPL" onPress={() => run('printRaw', () => Printer.printRaw(needDevice(), btoa(TEXT_JOB)))} />

      <Text style={styles.h}>Crachá (bitmap)</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nome" />
      <TextInput style={styles.input} value={gapMm} onChangeText={setGapMm} keyboardType="numeric" placeholder="Gap (mm)" />
      <View style={styles.preview}>
        <BadgeLabel ref={badgeRef} fullName={name} logoText="Reactivando" link="https://hubcommunity.io" width={width - 32} />
      </View>
      <Button
        title="2) Imprimir crachá (bitmap)"
        onPress={() => run('printBitmap', async () => {
          const png = await capture();
          say(`png capturado: ${Math.round(png.length / 1024)}KB base64`);
          return Printer.printBitmap(needDevice(), png, { gapMm: Number(gapMm) || 3 });
        })}
      />

      <Text style={styles.h}>Log</Text>
      {log.map((l, i) => (
        <Text key={i} style={styles.log}>{l}</Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  h: { fontWeight: '700', marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8 },
  preview: { borderWidth: 1, borderColor: '#ccc', alignSelf: 'flex-start' },
  log: { fontFamily: 'monospace', fontSize: 12 },
});
