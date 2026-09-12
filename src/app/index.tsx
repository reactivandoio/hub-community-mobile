import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';
import { EventsList } from '@/components/events-list';

export default function Index() {
  return (
    <>
      <Link href="/print-test" style={styles.spike}>
        [spike] teste de impressão USB
      </Link>
      <EventsList />
    </>
  );
}

const styles = StyleSheet.create({ spike: { padding: 16, color: '#8B5CF6' } });
