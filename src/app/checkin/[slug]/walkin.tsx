import { useLocalSearchParams, useRouter } from 'expo-router';
import { WalkinForm } from '@/components/checkin/walkin-form';

export default function WalkinRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  return <WalkinForm slug={slug} onDone={() => router.back()} />;
}
