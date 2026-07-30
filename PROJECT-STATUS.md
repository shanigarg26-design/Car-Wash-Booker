# CarCleanPro — Project Status & History

> Read this + `CLAUDE.md` at the start of any new chat (desktop or web) to get the full picture.
> This file is the GitHub-based "memory" of what has been done. It contains **no secrets**
> (all secrets live in Render / Neon / Google Console / GitHub Actions secrets).

_Last updated: 2026-07-30._

## What this is
A car-wash booking app: an **Expo/React Native** mobile app + an **Express** API backend, in a pnpm
workspace monorepo. Fully cloud-hosted; the running app has no dependency on any local machine.

## Cloud architecture (all live)
- **Code:** GitHub `shanigarg26-design/Car-Wash-Booker`, branch `main`. Source of truth.
- **Backend API:** Render web service `carcleanpro-api` → https://carcleanpro-api.onrender.com
  (auto-deploys on push; free tier sleeps after inactivity → first request can take ~50s).
- **Database:** Neon Postgres, project "Car Wash Booker". App reads/writes here.
- **Mobile app:** EAS project `shani-garg` (owner `shanigarg26s-team`), Android package
  `com.shanigarg26.carcleanpro`.

## Current working build
- **First fully-working APK:** commit `df57e0c`, build id `81941504-02e0-418a-b797-3866467acfdd`.
- Install page (open on Android): https://expo.dev/accounts/shanigarg26s-team/projects/shani-garg/builds/81941504-02e0-418a-b797-3866467acfdd
- **Login:** OTP bypass code `1111` on the phone verification screen.

## How updates reach the phone
- **JS/code changes** publish automatically as **EAS Updates** on push to `main`
  (`.github/workflows/eas-update.yml`, channel `preview`). Installed app picks them up on next
  close+reopen (~2–3 min end to end). No reinstall.
- **Native changes** (new native module, permission, icon, SDK upgrade) need a **new APK + reinstall**:
  run `.github/workflows/eas-build.yml` (GitHub Actions → Run workflow, or `gh workflow run eas-build.yml`).

## How to make changes
- Edit code, commit, `git push origin main`. `gh` CLI is authenticated (scopes repo + workflow).
- Everyday changes (text/screens/logic) → OTA, reopen the app.
- To build a native APK from CLI: `gh workflow run eas-build.yml --repo shanigarg26-design/Car-Wash-Booker`.

## Bugs fixed to get the app working (history)
1. **expo-router require.context bundling** — production build failed because `EXPO_ROUTER_APP_ROOT` /
   `EXPO_ROUTER_IMPORT_MODE` weren't inlined. Fixed with a custom Babel plugin in
   `artifacts/car-wash-mobile/babel.config.js` that inlines `EXPO_ROUTER_APP_ROOT` as a **relative**
   path per-file (an absolute path finds zero routes → "No routes found") and `EXPO_ROUTER_IMPORT_MODE=sync`.
   Don't reintroduce an absolute value.
2. **Native module version mismatch** — `expo-device`/`expo-notifications`/`expo-task-manager` were pinned
   to v55 (a newer SDK) while the app is SDK 54; native code crashed with "No virtual method
   getAppContext()". Fixed by pinning to SDK-54 versions (`expo-device ~8.0.10`,
   `expo-notifications ~0.32.16`, `expo-task-manager ~14.0.9`). Added `frozen-lockfile=false` to `.npmrc`
   so the cloud build re-resolves. Get correct versions via `curl -s https://unpkg.com/expo@<ver>/bundledNativeModules.json`.
3. **Google OAuth redirect_uri** — backend built the redirect URL from `REPLIT_DOMAINS` (empty off Replit →
   `https:///…`). Fixed in `artifacts/api-server/src/services/auth/google.router.ts` to derive from the
   request host (or `PUBLIC_BASE_URL`).

## Google login setup (done, needs final end-to-end test)
- Backend redirect_uri fix deployed.
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set in Render (were missing — only existed on Replit).
- Redirect URI `https://carcleanpro-api.onrender.com/api/auth/google/callback` added to the Google Cloud
  OAuth client ("Web client 1", project WashPro). Phone (OTP) login already works regardless.

## Data migration (done)
- Original data lived in the **Replit** database, not in the code. Migrated it into Neon via the Replit
  Shell: `pg_dump --data-only "$DATABASE_URL" | psql "<neon-url>"` (with `session_replication_role=replica`).
- Migrated: 7 users, 18 bookings, 2 cleaners, 21 booking_dispatches, 1 feedback. Reset all id sequences
  afterward (via Neon SQL Editor) so new sign-ups don't collide.

## Testing without a physical phone
- The APK runs in a browser Android emulator via **Appetize.io** (logged in with the user's Google).
  Upload a build by URL via the Appetize API; open `https://appetize.io/app/<publicKey>`, enable Debug
  Logs, "Tap to Start" — logcat shows real crashes.

## Pending / cleanup
- [ ] Finish end-to-end test of Google login (phone + emulator).
- [ ] **Rotate secrets** (they were exposed during setup): Neon DB password, Google OAuth client secret,
      and any API keys pasted into chat. Update Render env + Google Console after rotating.
- [ ] Optional: keep Render/Neon/Expo management on API/CLI instead of dashboards.

## Preferences
- User wants **zero local dependency** for running the app, and prefers edits committed directly to GitHub.
- Keep this file + `CLAUDE.md` updated as the durable, GitHub-based project memory.
