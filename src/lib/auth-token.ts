// The mobile equivalent of the web app's `localStorage.auth_token`, kept in the
// device keychain/keystore via expo-secure-store.
import * as SecureStore from 'expo-secure-store';

const KEY = 'auth_token';

export const getAuthToken = (): Promise<string | null> => SecureStore.getItemAsync(KEY);
export const setAuthToken = (token: string): Promise<void> => SecureStore.setItemAsync(KEY, token);
export const clearAuthToken = (): Promise<void> => SecureStore.deleteItemAsync(KEY);
