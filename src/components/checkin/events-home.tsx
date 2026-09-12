import { useApolloClient } from '@apollo/client';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { EventsList } from '@/components/events-list';
import { createApolloTransport } from '@/features/checkin/apollo-transport';
import { useCheckinStore, useLoadedEvents } from '@/features/checkin/store-provider';
import type { EventSummary } from '@/lib/types';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function EventsHome() {
  const store = useCheckinStore();
  const loaded = useLoadedEvents();
  const client = useApolloClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const open = (slug: string) => router.push(`/checkin/${slug}` as Href);

  const load = async (event: EventSummary) => {
    setBusy(event.slug);
    try {
      const signups = await createApolloTransport(client).fetchSignups(event.slug);
      store.loadEvent(event.slug, event.title, signups);
      open(event.slug);
    } catch (e) {
      Alert.alert('Sem conexão', `Não foi possível carregar o evento: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Loaded events come from the local store, so they open even when the
          `events` query fails (app killed and reopened without network). */}
      {loaded.length > 0 ? (
        <View style={styles.loaded}>
          <Text style={styles.heading}>Eventos carregados</Text>
          {loaded.map((l) => (
            <View key={l.slug} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.title}>{l.title}</Text>
                <Text style={styles.meta}>carregado às {hhmm(l.loadedAt)}</Text>
              </View>
              <Button title="Abrir" onPress={() => open(l.slug)} />
            </View>
          ))}
        </View>
      ) : null}
      <EventsList
        renderAction={(event) => {
          const cached = loaded.some((l) => l.slug === event.slug);
          return (
            <View style={styles.action}>
              <Button
                title={busy === event.slug ? 'Carregando...' : cached ? 'Recarregar' : 'Carregar evento'}
                disabled={busy === event.slug}
                onPress={() => void load(event)}
              />
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loaded: { paddingVertical: 8, backgroundColor: '#f4f4f5', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  heading: { fontWeight: '700', paddingHorizontal: 16, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  rowText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },
  action: { marginTop: 8 },
});
