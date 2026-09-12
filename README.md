# HubCommunity Mobile

App mobile do HubCommunity (Expo SDK 57, expo-router, TypeScript), cliente do mesmo BFF GraphQL usado pelo frontend web.

## Rodando

```bash
pnpm install
cp .env.example .env   # ajuste EXPO_PUBLIC_GRAPHQL_URL se for usar um BFF local
pnpm start             # Expo Go / dev client
pnpm ios               # simulador iOS
pnpm android           # emulador Android
pnpm test
```

Impressão USB exige dev build Android: `pnpm android` (emulador ou aparelho com OTG).

## Estrutura

```
src/
  app/          # rotas (expo-router) — só telas e layouts
  components/   # componentes de tela/feature
  lib/          # apollo-client, auth-token (SecureStore), jwt, queries, types
```
