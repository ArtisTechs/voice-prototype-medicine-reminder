---
name: mobile-expo
description: Use when writing code in apps/mobile (Expo SDK 58 + TypeScript + Expo Router). Covers the route layout, API client and token refresh, TanStack Query keys and invalidation, react-hook-form + zod forms, notifications, the camera (barcode + reference photos), secure token storage, WebSocket realtime, and running the dev server in Docker and opening it on a phone.
---

# Mobile (Expo) conventions

## Layout
```
apps/mobile/                   (SDK 58: routes live in src/app, package.json main = "expo-router/entry")
  src/app/_layout.tsx          providers: Theme, QueryClient, Auth, Realtime; Stack.Protected auth guard
  src/app/sign-in.tsx  sign-up.tsx
  src/app/(app)/(tabs)/_layout.tsx index.tsx (Dashboard) alerts.tsx settings.tsx
  src/app/(app)/patients/new.tsx  join.tsx
  src/app/(app)/patients/[patientId]/index.tsx      Today timeline + links
  src/app/(app)/patients/[patientId]/medicines/new.tsx  [medicineId].tsx
  src/app/(app)/patients/[patientId]/history.tsx  device.tsx  scans.tsx  share.tsx  medicines.tsx
  src/api/client.ts   keys.ts   types.ts   hooks/*.ts
  src/auth/  src/realtime/  src/notifications/  src/theme/  src/components/  src/features/  src/lib/
```
Routes stay thin. SDK 58 router: no `initialRouteName` (use `unstable_settings = { anchor }`), no `redirect` prop on `Screen` (render `<Redirect>`), auth via `<Stack.Protected guard={...}>`.
Routes stay thin. They compose `src/features/<area>/*` components.

## API client (`src/api/client.ts`)
- The base URL is `process.env.EXPO_PUBLIC_API_URL` (e.g. `http://192.168.1.20:5000`). All paths are `/api/v1/...`.
- `api<T>(path, {method, body, query})` adds `Authorization: Bearer <access>`. On a 401 it calls `/auth/refresh` **once** (single-flight promise), retries, and if that fails it signs out.
- Errors become `ApiError {status, code, message}` from the backend's `{"error":{...}}`. A network failure becomes `code: "network"`.
- Uploads (photos) use `FormData` with `{uri, name, type}`.

## Query keys (`src/api/keys.ts`), the only place keys are built
```ts
qk.me()                         ['me']
qk.dashboard()                  ['dashboard']
qk.alerts()                     ['alerts']
qk.patient(id)                  ['patient', id]            // prefix for everything below
qk.today(id)                    ['patient', id, 'today']
qk.medicines(id)                ['patient', id, 'medicines']
qk.medicine(id, mid)            ['patient', id, 'medicines', mid]
qk.history(id, from, to)        ['patient', id, 'history', from, to]
qk.device(id)                   ['patient', id, 'device']
qk.scans(id)                    ['patient', id, 'scans']
```
- **Defaults:** `staleTime 30s`, `retry 2` (none on 4xx), `refetchOnReconnect`, `refetchOnWindowFocus` through `AppState` focusManager.
- **Mutations** invalidate the narrowest prefix: a medicine edit → `qk.medicines(pid)` + `qk.today(pid)` + `qk.dashboard()`.
- **Realtime messages** (`{type, patientId}`): `intake.updated`/`device.updated` → invalidate `qk.patient(pid)` + `qk.dashboard()`; `alert.created` → `qk.alerts()` + `qk.dashboard()`; `scan.created` → `qk.scans(pid)`.

## Forms
- `react-hook-form` + `zodResolver`. The schema lives in `src/features/<area>/schema.ts` and is also exported for tests.
- Use controlled components through `<FormTextField control name label />` wrappers. Never hand-roll `useState` per field.
- Map server 409/422 errors back with `setError(field, ...)`.

## Auth and storage
- Tokens go in `expo-secure-store` (`medrem.access`, `medrem.refresh`). Never AsyncStorage. Nothing personal in AsyncStorage.
- `AuthProvider` exposes `{status: 'loading'|'signedOut'|'signedIn', signIn, signUp, signOut}`. `app/_layout.tsx` redirects based on it.

## Realtime
- `src/realtime/RealtimeProvider.tsx` opens `ws(s)://<host>/api/v1/ws?token=<access>`. It reconnects with backoff (1, 2, 5, 10 s), pings every 25 s, and reconnects when the app comes to the foreground.
- It works in Expo Go (plain WebSocket). New alerts also show an in-app toast/banner.

## Notifications
- `expo-notifications`. Handler returns `shouldShowBanner`/`shouldShowList` (`shouldShowAlert` is deprecated). Create the Android channel **before** requesting the token. Ask for permission after sign-in (with a short explainer first), get `getExpoPushTokenAsync({projectId})`, and `POST /api/v1/me/push-tokens`.
- **Expo Go on Android cannot receive remote push (SDK 53+).** Use the dev client: `npx expo install expo-dev-client`, `eas build --profile development --platform android`, then `npx expo start --dev-client`. In Expo Go, skip registration quietly; in-app alerts still arrive over WebSocket.
- Android channel `alerts` with importance HIGH. A tap on a notification deep-links to `data.url` (e.g. `/patients/3`).

## Camera
- `expo-camera` `CameraView`. Barcode: `barcodeScannerSettings={{barcodeTypes:['ean13','ean8','upc_a','upc_e','code128','qr']}}`, take the first result, then close. Reference photo: `takePictureAsync({quality:0.7})`, then resize to ≤1280 px with `ImageManipulator.manipulate(uri).resize({width:1280}).renderAsync()` → `saveAsync({format: SaveFormat.JPEG, compress: 0.8})` (`manipulateAsync` is deprecated in SDK 58), then upload.
- Always handle permission denied with a plain explanation and a "Type it instead" fallback.

## Docker / phone
- `make up` starts `mobile` (`node:22`), which runs `npx expo start --lan --port 8081 --go` (Expo Go; `EXPO_CLIENT=dev-client` switches to the dev build). Edits sync from `/host` into `/app` every second (D17). `REACT_NATIVE_PACKAGER_HOSTNAME=${LAN_IP}` makes the QR code point at the PC.
- On the phone: install **Expo Go** (it must support SDK 58), use the same WiFi, scan the QR code from `make logs-mobile`, or enter `exp://<LAN_IP>:8081`.
- LAN blocked (guest WiFi / AP isolation): set `EXPO_TUNNEL=true` in `.env` (runs `--tunnel` through ngrok).
- `node_modules` lives in a container volume. Add packages on the host with `npx expo install <pkg>` (this updates the lockfile); the container runs `npm ci` when `package-lock.json` changes.

## Tests
Jest 30 (`jest-expo` preset) + `@testing-library/react-native` 14 (`await render(...)`). Test zod schemas, `qk`, the client refresh logic (mock fetch), and key components (`StatusBadge` shows icon + word).
