import { useLocalSearchParams } from 'expo-router';
import { CheckinScreen } from '@/components/checkin/checkin-screen';

export default function CheckinRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CheckinScreen slug={slug} />;
}
