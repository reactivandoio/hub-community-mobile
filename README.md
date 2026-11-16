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

O login é só por código enviado ao e-mail. O menu "Gestão de eventos" (check-in, inscrição na porta,
totem) aparece só para Admin, Community Manager e Event Manager, com os eventos que a pessoa gere.
Plano de paridade com o web: [`docs/paridade-web.md`](docs/paridade-web.md).

## Estrutura

```
src/
  app/          # rotas (expo-router) — só telas e layouts
  components/   # componentes de tela/feature
  lib/          # apollo-client, auth-token (SecureStore), jwt, queries, types
```
