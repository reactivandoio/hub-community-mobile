import { Stack, useLocalSearchParams } from 'expo-router';
import { KioskScreen } from '@/components/kiosk/kiosk-screen';

export default function KioskRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <KioskScreen slug={slug} />
    </>
  );
}
