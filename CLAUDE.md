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
- **The scanner is the totem's own, not CameraX** (`modules/topwise-scanner`). On the Gertec SK-210
  `expo-camera` opens either lens, CameraX reports no error and the preview stays black, while the
  stock camera app works — so the gap is CameraX. The device is a rebadged Topwise CloudPOS, and its
  service drives the camera itself.
  - The AIDL under `modules/topwise-scanner/android/src/main/aidl` was recovered from
    `/system/app/TOPUSDKService/TOPUSDKService.apk`, pulled off the device: the `TRANSACTION_*`
    constants in each `$Stub` give the declaration order, which is what AIDL numbers methods by —
    `dexdump` lists them alphabetically, so trusting that order would have produced a wrong wire
    protocol that still compiled.
  - `TopwiseScannerView` is the one the kiosk uses: `startDecode` in `MODE_CONTINUE_SCAN_CODE` streams
    `onResult` plus raw NV21 frames through `onPreview`, so the preview lives inside our layout.
    Frames are throttled to ~10 fps (each costs a YUV→JPEG→Bitmap round trip on a 2 GB device).
  - `scan()` is the other entry point: the vendor's own full-screen reader. It needs
    `getSerializable("scanCode")` holding a real `com.topwise.cloudpos.data.AidlScanParam` — an empty
    Bundle is refused with ERROR_INPUT_PARAMS (109007). That class declares no serialVersionUID, so it
    is loaded from the service's APK through `createPackageContext` rather than copied.
  - Always end a session (`stopScan`/`stopDecode`): the service keeps an `isScanIng` flag and holds the
    camera, so without it the first read works and every one after comes up black.
  - `isAvailable()` is false on the operators' phones, and the kiosk falls back to name search there.
- `parseTicket` (`src/features/checkin/ticket.ts`) still accepts the ticket URL or a bare id, so whichever
  scanner path lands can feed the same flow.
- `useKioskFlow` is the state machine (scan skips confirmation, name search requires it; a cache miss runs
  `syncNow()` once before "not found"). It takes every side effect by injection — test it with fakes.
- An empty cache says so on screen and offers a sync: silently answering "not found" to everybody is the
  worst failure at a door.
