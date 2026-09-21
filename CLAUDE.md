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

## Offline check-in (`src/features/checkin`, `src/features/printer`)
- Spec: `docs/superpowers/specs/2026-09-12-offline-checkin-design.md`.
- `CheckinStore` holds every loaded event in memory and persists each as JSON in MMKV (`checkin:<slug>`); `SyncEngine` pulls `eventSignups` every 30 s and pushes the outbox FIFO through `CheckinTransport`. Pure modules take storage/transport/connectivity by injection — tests use `MemoryStorage`, `FakeConnectivity` and a mocked transport, never MMKV/NetInfo.
- Printing: `modules/tspl-usb-printer` (Kotlin, USB Host + TSPL) — Android dev build only (`pnpm android`). `usePrintBadge` renders `BadgeLabel` offscreen, captures PNG with view-shot and sends it as a 1bpp `BITMAP`.
- Tests that import printer hooks must `jest.mock('../../../../modules/tspl-usb-printer', ...)`.
- `modules/**/android/build` is git-ignored (native build output); a native rebuild (`pnpm android`) is required whenever native dependencies change, since it isn't produced by `pnpm start`/Metro alone.

## Kiosk mode (`src/features/kiosk`, `src/components/kiosk`)
- Spec: `docs/superpowers/specs/2026-09-18-kiosk-mode-design.md`. Route `checkin/[slug]/kiosk`, entered
  from the operator screen ("Modo totem"). No header, no scrolling: it all fits one screen. Hidden exit
  is a 2 s long-press on the whole "Ainda não se inscreveu?" card (its children are `pointerEvents="none"`
  — the QR is an SVG and was swallowing the gesture).
- **There is no scanner in the kiosk today; it credentials by name.** On the Gertec SK-210 (MediaTek,
  Android 13) neither input the hardware advertises works:
  - `expo-camera` opens either lens, CameraX reports no error, and the preview stays black. Ruled out:
    the rounded `overflow: 'hidden'` frame, a stale camera held by another app, fresh permissions, both
    lenses, and `PreviewView` in TextureView mode (`patches/expo-camera@57.0.5.patch`, kept for whoever
    picks this up). CameraX 1.6 is camera-pipe all the way down — `camera-camera2` there is an adapter
    over it, so excluding the pipe throws `NoClassDefFoundError`; pinning the group to 1.4.2 builds but
    the camera never opens at all.
  - The device's own barcode reader (`com.android.scanneraskeyboard`, which types what it scans) does not
    pick up a QR, though the spec claims 1D+2D. The vendor path not yet tried is the Topwise AIDL SDK
    behind `com.android.topwise.topusdkservice`.
  - The stock `com.mediatek.camera` app previews fine, so the hardware is capable — the gap is CameraX.
- `parseTicket` (`src/features/checkin/ticket.ts`) still accepts the ticket URL or a bare id, so whichever
  scanner path lands can feed the same flow.
- `useKioskFlow` is the state machine (scan skips confirmation, name search requires it; a cache miss runs
  `syncNow()` once before "not found"). It takes every side effect by injection — test it with fakes.
- An empty cache says so on screen and offers a sync: silently answering "not found" to everybody is the
  worst failure at a door.
