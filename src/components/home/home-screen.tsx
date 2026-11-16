import { useRouter, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { useCheckinStore } from '@/features/checkin/store-provider';
import { canManageEvents, roleLabel } from '@/lib/admin-access';

const SITE_URL = 'https://hubcommunity.io';

/**
 * Home after the login (REA-58). The management menu (check-in, walk-in, kiosk) shows up only for
 * Admin, Community Manager and Event Manager — whatever the BFF's adminAccess says. Everyone else
 * gets the participant side, which today is still the site (see docs/paridade-web.md).
 */
export function HomeScreen() {
  const { session, access, accessStatus, refreshAccess, signOut } = useAuth();
  const checkin = useCheckinStore();
  const router = useRouter();
  if (session.status !== 'signedIn') return null;
  const { user } = session;

  const confirmSignOut = () => {
    const pending = checkin.pendingCount();
    const warning =
      pending > 0
        ? `${pending} ${pending === 1 ? 'registro ainda não foi enviado' : 'registros ainda não foram enviados'} ao servidor e ${pending === 1 ? 'será descartado' : 'serão descartados'}. `
        : '';
    Alert.alert('Sair da conta?', `${warning}As listas de inscritos guardadas neste aparelho serão apagadas.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.hello}>Olá{user.name ? `, ${user.name.split(' ')[0]}` : ''}!</Text>
        <Text style={styles.meta}>{user.email}</Text>
        {access ? <Text style={styles.meta}>{roleLabel(access.role)}</Text> : null}
      </View>

      {accessStatus === 'loading' ? (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={styles.meta}>Verificando suas permissões…</Text>
        </View>
      ) : null}

      {accessStatus === 'error' ? (
        <View style={styles.card}>
          <Text style={styles.meta}>Não foi possível verificar suas permissões. Confira a internet.</Text>
          <MenuButton title="Tentar de novo" onPress={() => void refreshAccess()} />
        </View>
      ) : null}

      {canManageEvents(access) ? (
        <View style={styles.card}>
          <Text style={styles.section}>Gestão de eventos</Text>
          <MenuButton
            title="Check-in dos meus eventos"
            subtitle="Credenciamento, inscrição na porta, totem e etiquetas"
            onPress={() => router.push('/gestao' as Href)}
          />
        </View>
      ) : null}

      {accessStatus === 'ready' && !canManageEvents(access) ? (
        <View style={styles.card}>
          <Text style={styles.section}>Seus eventos</Text>
          <Text style={styles.meta}>
            Em breve você verá aqui suas inscrições e ingressos. Por enquanto, use o site.
          </Text>
          <MenuButton title="Abrir hubcommunity.io" onPress={() => void WebBrowser.openBrowserAsync(SITE_URL)} />
        </View>
      ) : null}

      <MenuButton title="Sair" onPress={confirmSignOut} subtle />
    </ScrollView>
  );
}

function MenuButton({
  title,
  subtitle,
  onPress,
  subtle,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  subtle?: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, subtle && styles.subtle]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={[styles.buttonText, subtle && styles.subtleText]}>{title}</Text>
      {subtitle ? <Text style={styles.buttonSub}>{subtitle}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 4 },
  hello: { fontSize: 22, fontWeight: '700' },
  section: { fontSize: 17, fontWeight: '700' },
  meta: { fontSize: 14, color: '#555' },
  button: { backgroundColor: '#10B981', borderRadius: 8, padding: 14 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonSub: { color: '#ecfdf5', fontSize: 13, marginTop: 2 },
  subtle: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ccc' },
  subtleText: { color: '#b00020' },
});
