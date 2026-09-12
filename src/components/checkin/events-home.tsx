import { useApolloClient } from '@apollo/client';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, StyleSheet, View } from 'react-native';
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

  const load = async (event: EventSummary) => {
    setBusy(event.slug);
    try {
      const signups = await createApolloTransport(client).fetchSignups(event.slug);
      store.loadEvent(event.slug, event.title, signups);
      router.push(`/checkin/${event.slug}` as Href);
    } catch (e) {
      Alert.alert('Sem conexão', `Não foi possível carregar o evento: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <EventsList
      renderAction={(event) => {
        const cached = loaded.find((l) => l.slug === event.slug);
        return (
          <View style={styles.action}>
            {cached ? (
              <Button
                title={`Abrir (carregado às ${hhmm(cached.loadedAt)})`}
                onPress={() => router.push(`/checkin/${event.slug}` as Href)}
              />
            ) : (
              <Button
                title={busy === event.slug ? 'Carregando...' : 'Carregar evento'}
                disabled={busy === event.slug}
                onPress={() => void load(event)}
              />
            )}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({ action: { marginTop: 8 } });
