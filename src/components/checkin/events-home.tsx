import { useApolloClient, useQuery } from '@apollo/client';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { EventsList, EVENTS_VARIABLES } from '@/components/events-list';
import { useAuth } from '@/features/auth/auth-provider';
import { createApolloTransport } from '@/features/checkin/apollo-transport';
import { useCheckinStore, useLoadedEvents } from '@/features/checkin/store-provider';
import { manageableEvents, managesEvent } from '@/lib/admin-access';
import { EVENTS } from '@/lib/queries';
import type { EventsResponse, EventSummary } from '@/lib/types';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * The management menu (REA-58): only the events this user may manage, by the BFF's rules
 * (lib/admin-access.ts). Reached only by Admin, Community Manager and Event Manager.
 */
export function EventsHome() {
  const store = useCheckinStore();
  const { access } = useAuth();
  const client = useApolloClient();
  // Same query as EventsList (deduplicated by Apollo): the community of each event decides
  // whether a community manager sees the loaded copy below.
  const { data } = useQuery<EventsResponse>(EVENTS, { variables: EVENTS_VARIABLES });
  const known = data?.events?.data;
  // Offline (no list), the loaded events stay: they were loaded by this same person, since
  // another sign-in on the device wipes them (AuthProvider.signIn).
  const loaded = useLoadedEvents().filter(
    (l) => managesEvent(access, { slug: l.slug }) || !known || manageableEvents(access, known).some((e) => e.slug === l.slug),
  );
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
        filter={(events) => manageableEvents(access, events)}
        emptyText="Nenhum evento para você gerir."
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
