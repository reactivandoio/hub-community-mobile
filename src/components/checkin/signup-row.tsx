import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocalSignup } from '@/features/checkin/types';

export function SignupRow({ signup, onPress }: { signup: LocalSignup; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.info}>
        <Text style={styles.name}>{signup.name}</Text>
        <Text style={styles.meta}>{[signup.email, signup.product_name].filter(Boolean).join(' · ')}</Text>
      </View>
      {signup.checked_in ? <Text style={styles.badge}>credenciado</Text> : null}
      {signup.source === 'walkin' && signup.id.startsWith('local:') ? <Text style={styles.local}>na hora</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc', gap: 8 },
  pressed: { backgroundColor: '#f4f4f5' },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },
  badge: { fontSize: 12, color: '#065f46', backgroundColor: '#d1fae5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  local: { fontSize: 12, color: '#5b21b6', backgroundColor: '#ede9fe', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
});
