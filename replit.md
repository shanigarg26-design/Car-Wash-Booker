# Workspace

## Overview

pnpm workspace monorepo using TypeScript. **CarCleanPro** — an Uber/Ola-style on-demand car cleaning booking platform. Customers book at their GPS location; the system dispatches to the 5 nearest cleaners; the first to accept gets the job.

> **Terminology**: All "wash/washer" references have been renamed to "clean/cleaner" throughout the UI, code, and database (tables, columns, API routes). The legacy DB fields and API endpoint aliases (`washerName`, `/api/nearby-washers`, etc.) are kept for backward compatibility only.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 (modular service architecture)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Build**: esbuild (CJS bundle)
- **Mobile**: Expo SDK 54 + React Native (Expo Router v4 file-based routing)
- **Auth**: express-session + bcryptjs + OTP (Fast2SMS) + Google OAuth

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port 8080)
│   └── car-wash-mobile/    # Expo React Native app (CarCleanPro)
├── lib/
│   └── db/                 # Drizzle ORM schema + DB connection
├── pnpm-workspace.yaml
└── replit.md
```

## App Features

### User Roles
- **Customer**: Book car washes at GPS location, track booking status, rate washers
- **Washer**: Accept/decline dispatch requests, complete bookings, manage availability
- **Admin**: Analytics dashboard at `/admin`

### Key Flows — Uber/Ola-style Dispatch
1. Customer opens app → authenticates via OTP or Google OAuth
2. Customer selects vehicle type + wash type → picks location on map → taps "Book"
3. **API** dispatches to up to 5 nearest available washers simultaneously
4. **Washers** see incoming notification, Accept or Decline
5. **First washer to accept** gets the job — all other dispatch records cancel
6. If no washers accept → fallback to next 5 nearest, eventually `cancelled`
7. Customer sees animated "Searching..." → "Washer Found!" status screen
8. Booking statuses: `searching` → `accepted` → `completed` / `cancelled`

## Database Schema

- `users` — all users (customers, washers) with hashed passwords + lat/lng + `isAdmin`
- `washers` — washer profiles (price, availability, bio, rating, totalWashes)
- `bookings` — booking records (customerLat/Lng, status, vehicleType, washType, priceQuoted)
- `booking_dispatches` — tracks which washers were dispatched per booking
- `feedback` — ratings 1-5 per booking, reviewerRole (customer/washer), optional comment

## Pricing

8 vehicle types × 2 wash types (exterior / both). `calcPrice(vehicleType, washType)` in `services/booking/service.ts` is server-authoritative.
Prices stored as **integers in rupees** — do NOT divide by 100. Range: ₹120–₹700.

## API Routes

All routes under `/api`:
- `POST /users/register`, `POST /users/login`, `GET /users/me`, `POST /users/logout`
- `POST /auth/send-otp`, `POST /auth/verify-otp` — SMS OTP flow (Fast2SMS)
- `GET /auth/google`, `GET /auth/google/callback` — Google OAuth
- `GET /washers`, `POST /washers`, `GET /washers/me`, `PATCH /washers/me`
- `GET /bookings`, `POST /bookings` — Uber dispatch (no washerId in POST body)
- `PATCH /bookings/:id/accept|decline|complete|cancel`
- `GET /geocode/search`, `GET /geocode/reverse` — Nominatim proxy (bypass CORS)
- `POST /feedback`, `GET /feedback/booking/:id`
- `POST /admin/login`, `POST /admin/logout`, `GET /admin/stats`, `GET /admin/users`

## Admin Dashboard

- Routes: `/admin/login` and `/admin/dashboard` on the API server's web frontend
- Credentials: `admin@carcleanpro.in` / `Admin@123`
- Analytics: booking trends, status breakdown, vehicle/wash-type charts, top washers, feedback feed

## Icon System (Critical — pnpm + Expo Go compat)

`@expo/vector-icons` (Feather/AntDesign) **cannot be used** — pnpm non-flat node_modules + Expo Go on Android pre-marks fonts as loaded without native registration → ⊠ glyph boxes.

### Replacements
- **`AppIcon`** (`components/AppIcon.tsx`) — native: uses `lucide-react-native` (SVG via react-native-svg)
- **`AppIcon.web`** (`components/AppIcon.web.tsx`) — web: uses `lucide-react` (standard HTML SVG; avoids react-native-svg Metro resolution issues on web)
- **`GoogleIcon`** (`components/GoogleIcon.tsx`) — native: uses `react-native-svg` directly
- **`GoogleIcon.web`** (`components/GoogleIcon.web.tsx`) — web: uses plain `<svg>` HTML element

### Rules
- Always import `AppIcon` from `@/components/AppIcon` — Metro resolves to the correct platform file
- Always import `GoogleIcon` from `@/components/GoogleIcon` — same platform resolution
- **Never** use `@expo/vector-icons` anywhere in the project

## Font Loading

`@expo-google-fonts/inter` (Inter 400/500/600/700) loaded via `useFonts` in `app/_layout.tsx`.

**Web caveat**: `useFonts` on web can hang indefinitely (font promise never resolves/rejects in some environments). The `_layout.tsx` guard `if (!fontsLoaded && !fontError)` is web-bypassed:
```tsx
if (!fontsLoaded && !fontError && Platform.OS !== 'web') return null;
```
On web the app renders immediately with system fallback fonts, then upgrades to Inter once loaded.

## Map Implementation

`react-native-maps` is NOT compatible with pnpm non-flat node_modules. Maps use:
- **Native** (`components/MapPickerView.tsx`): Leaflet/OSM embedded in `react-native-webview`
- **Web** (`components/MapPickerView.web.tsx`): Leaflet in a blob-URL `<iframe>`
- `postMessage` relay for location → `panTo` protocol for crosshair and "Use My Current Location"

## SMS OTP — Fast2SMS

- Helper: `artifacts/api-server/src/lib/twilio.ts` (filename kept, now uses Fast2SMS)
- Requires `FAST2SMS_API_KEY` secret. Without it → **dev mode**: OTP logged to console + returned as `devOtp` in API response
- Master bypass OTP: `1111` (dev only)
- Fast2SMS API: GET `https://www.fast2sms.com/dev/bulkV2?route=otp` with 10-digit phone

## Google OAuth

Env vars: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`

## Animation Rules

- Always `useNativeDriver: false` for opacity/transform animations (web compat)
- On web, skip fade-in animations (set initial value to 1) to avoid blank preview frames:
  ```tsx
  const isWeb = Platform.OS === 'web';
  const fadeAnim = useRef(new Animated.Value(isWeb ? 1 : 0)).current;
  ```

## Colors

```
dark bg:   #0A1628
tint:      #2563EB
card:      #1E293B
icon dim:  #64748B
```

## API Server

- Port: 8080 (env: `PORT`)
- Base URL in mobile app: `EXPO_PUBLIC_API_BASE` env var
- Credentials: `credentials: 'include'` on all fetch calls (session cookie)

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API. Modular service architecture:
```
src/
  gateway/index.ts          ← API gateway — mounts all service routers
  services/
    auth/
      phone.router.ts       ← OTP / phone auth (check, send, verify, register, link)
      google.router.ts      ← Google OAuth (init, callback, session, pending, complete)
    booking/
      router.ts             ← Booking HTTP routes (thin layer)
      service.ts            ← enrichBooking, calcPrice, PRICING table, generateServiceOtp
      dispatcher.ts         ← Dispatch engine (haversineKm, dispatchToNearestWashers, scheduleSearchRetry)
    washer/router.ts        ← Washer profile + availability
    user/router.ts          ← User register/login/profile/avatar/GPS update
    feedback/router.ts      ← Ratings and reviews
    admin/router.ts         ← Admin auth + analytics dashboard
    location/router.ts      ← Geocoding (Nominatim reverse + search + IP location)
    owner/router.ts         ← Car-wash owner business profiles
  shared/
    push.ts                 ← sendPush() helper (Expo push API, fire-and-forget)
    middleware.ts           ← requireAuth(), adminOnly(), getSessionUserId()
  lib/twilio.ts             ← SMS OTP via Fast2SMS
  app.ts                    ← Express app setup (CORS, session, static, /api mount)
```

Pricing stored server-side in `services/booking/service.ts:PRICING` — authoritative, not per-washer.

### `artifacts/car-wash-mobile` (`@workspace/car-wash-mobile`)

Expo SDK 54 React Native app. File-based routing via Expo Router. Tab navigator for customers (Home, Bookings, Profile) and washers (Dashboard, Bookings, Profile).

### `lib/db` (`@workspace/db`)

Drizzle ORM with PostgreSQL. Dev: `pnpm --filter @workspace/db run push` (or `push-force`).
