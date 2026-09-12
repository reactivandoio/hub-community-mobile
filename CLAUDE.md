@AGENTS.md

# HubCommunity Mobile - Development Guide

Expo SDK 57 (React Native 0.86, React 19.2), expo-router with `src/app`, TypeScript strict, pnpm.

## Commands
- `pnpm start` / `pnpm ios` / `pnpm android` — dev server / simulators
- `pnpm test` — Jest (`jest-expo` preset) + `@testing-library/react-native`
- `pnpm lint` — expo lint

## Architecture
- Talks to the same GraphQL BFF as the web frontend (`EXPO_PUBLIC_GRAPHQL_URL`, default production). Reuse operation shapes from `hub-community-frontend/src/lib/queries.ts`.
- `src/lib/apollo-client.ts` — `createAuthLink` attaches `Authorization: Bearer` only for a stored, non-expired token (same rule as the web `authLink`); expired tokens are cleared. Token lives in `expo-secure-store` (`src/lib/auth-token.ts`).
- `src/app/` holds ONLY routes/layouts — every file there becomes a route, so screen components and their tests live in `src/components/`.
- GraphQL operations in `src/lib/queries.ts`, types in `src/lib/types.ts`.

## Testing
- Tests in colocated `__tests__/` folders (`*.test.ts(x)`), never inside `src/app/`.
- RNTL 14: `render` is async — `await render(...)` before using `screen`.
- Apollo `MockedProvider` needs `__typename` in mocked data.
