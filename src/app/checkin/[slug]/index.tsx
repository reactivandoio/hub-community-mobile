import { useLocalSearchParams } from 'expo-router';
import { CheckinScreen } from '@/components/checkin/checkin-screen';

export default function CheckinRoute() {
  const { slug, select, t } = useLocalSearchParams<{ slug: string; select?: string; t?: string }>();
  return <CheckinScreen slug={slug} select={select} selectKey={t ?? select} />;
}
