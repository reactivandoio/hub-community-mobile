import { useLocalSearchParams, useRouter } from 'expo-router';
import { WalkinForm } from '@/components/checkin/walkin-form';

export default function WalkinRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  return (
    <WalkinForm
      slug={slug}
      onDone={() => router.back()}
      // dismissTo pops back to the check-in screen already in the stack and
      // hands it the params (replace would stack a second check-in screen,
      // with a second SyncEngine, on top of the first).
      onExisting={(id) => router.dismissTo({ pathname: '/checkin/[slug]', params: { slug, select: id, t: String(Date.now()) } })}
    />
  );
}
