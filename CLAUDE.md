# CarCleanPro (Car-Wash-Booker)

A car-wash booking app: an Expo/React Native mobile app + an Express API backend, in a pnpm workspace monorepo. Fully cloud-hosted — no laptop dependency to run the app.

## What lives where

- `artifacts/car-wash-mobile/` — Expo SDK 54 / React Native app (expo-router file-based routing under `app/`).
- `artifacts/api-server/` — Express 5 API, bundled to `dist/index.cjs` with esbuild.
- `artifacts/*` other workspaces — shared DB (Drizzle ORM + Postgres), API client, etc.
- Root is a pnpm monorepo (`pnpm-workspace.yaml`), Node 24, pnpm pinned via `packageManager`.

## Cloud deployment (all live)

- **Code:** GitHub `shanigarg26-design/Car-Wash-Booker`, branch `main`.
- **Backend:** Render web service `carcleanpro-api` → https://carcleanpro-api.onrender.com (blueprint `render.yaml`, health `/api/healthz`).
- **Database:** Neon serverless Postgres.
- **Mobile:** EAS project `shani-garg` (owner `shanigarg26s-team`), Android package `com.shanigarg26.carcleanpro`. First successful APK: commit `ebc5769`.

## How updates reach the installed app (the whole point)

- **JS/code changes** publish automatically as **EAS Updates** on push to `main` (`.github/workflows/eas-update.yml`, channel `preview`). The installed app picks them up on **next close + reopen** — no reinstall.
- **New native APK** (rare) only needed for new native modules or permission/icon changes: run the `.github/workflows/eas-build.yml` workflow (GitHub Actions → Run workflow).

So the normal loop is: **edit code → commit & push → user reopens the app to see it.**

### Standing rule for every app-facing change (user request)

1. **Bump the build stamp.** On every change that affects the mobile app, set `artifacts/car-wash-mobile/constants/build.ts` `BUILD_TAG` to a NEW unique string (e.g. `teal-falcon-4517`). This is how the user visually confirms the update landed on their phone.
2. **Land it on `main`.** Only pushes to `main` publish an EAS Update to the phone — work left on a feature branch never reaches the user. Merge/push to `main` so the change is actually delivered.

## Login

On the phone verification screen, OTP bypass code is **`1111`** (skips SMS).

## Gotchas / history

- expo-router in this monorepo needs env vars force-inlined for native builds — see `artifacts/car-wash-mobile/babel.config.js` (`EXPO_ROUTER_APP_ROOT`, `EXPO_ROUTER_IMPORT_MODE` via `transform-inline-environment-variables`). Don't remove this.
- Root `.npmrc` has `node-linker=hoisted` for RN/pnpm native-build compatibility.
- EAS free-tier build queue can wait ~1–2 hours before a build compiles.

## Deferred security cleanup (do when convenient)

- Rotate the Neon DB password and Google OAuth client secret (both were exposed during setup).
