import { useQuery } from '@apollo/client';
import type { ReactNode } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { EVENTS } from '@/lib/queries';
import type { EventsResponse, EventSummary } from '@/lib/types';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

function EventRow({ event, action }: { event: EventSummary; action?: ReactNode }) {
  const place = [event.location?.title, event.location?.city].filter(Boolean).join(' · ');
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.meta}>{formatDate(event.start_date)}</Text>
      {place ? <Text style={styles.meta}>{place}</Text> : null}
      {action}
    </View>
  );
}

export function EventsList({ renderAction }: { renderAction?: (event: EventSummary) => ReactNode }) {
  const { data, loading, error } = useQuery<EventsResponse>(EVENTS, {
    variables: { sort: [{ start_date: 'DESC' }] },
  });
  const events = data?.events?.data ?? [];

  if (loading) return <ActivityIndicator style={styles.center} />;
  if (error) return <Text style={[styles.center, styles.error]}>Erro ao carregar eventos: {error.message}</Text>;

  return (
    <FlatList
      data={events}
      keyExtractor={(event) => event.id}
      renderItem={({ item }) => <EventRow event={item} action={renderAction?.(item)} />}
      contentContainerStyle={events.length === 0 ? styles.center : undefined}
      ListEmptyComponent={<Text style={styles.meta}>Nenhum evento encontrado.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc' },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },
  error: { color: '#b00020', textAlign: 'center' },
});
