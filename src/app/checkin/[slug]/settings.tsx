import { useLocalSearchParams } from 'expo-router';
import { EventSettingsScreen } from '@/components/checkin/event-settings-screen';

export default function SettingsRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <EventSettingsScreen slug={slug} />;
}
