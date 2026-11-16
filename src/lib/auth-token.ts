// The mobile equivalent of the web app's localStorage (`auth_token`, `auth_user`), kept in the
// device keychain/keystore via expo-secure-store. Only SessionStore reads and writes it.
import * as SecureStore from 'expo-secure-store';
import type { SecretStorage } from '@/features/auth/session';

export const secureStorage: SecretStorage = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};
