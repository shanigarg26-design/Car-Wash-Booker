# CarCleanPro — Project Status (updated 2026-07-31)

On-demand car wash app. **Everything is cloud-hosted; no laptop dependency.** A new
Claude session (desktop, web at claude.ai/code, or mobile) can pick up from here — read
this + `CLAUDE.md`, then work directly on GitHub via `gh`.

## Architecture / where things live
- **Code:** GitHub `shanigarg26-design/Car-Wash-Booker` (branch `main`). Monorepo:
  `artifacts/api-server` (Express backend), `artifacts/car-wash-mobile` (Expo/React Native app),
  `lib/db` (Drizzle schema, Neon Postgres), `lib/api-zod` (shared zod schemas).
- **Backend:** Render web service `carcleanpro-api` (https://carcleanpro-api.onrender.com),
  auto-deploys on push to main (build runs `drizzle-kit push --force` → schema changes auto-apply).
  Health `/api/healthz`. `render.yaml` has a `buildFilter` so mobile/docs/.github changes DON'T redeploy the API.
- **Database:** Neon Postgres (project `royal-mud-88588731`, org `org-billowing-cell-76962707`).
- **Mobile app:** Expo SDK 54, EAS project `d4b8d786-3cf7-4a02-acbf-d9405f07ce48` (owner `shanigarg26s-team`).
  JS changes ship as **EAS Updates (OTA)** on push to main (`.github/workflows/eas-update.yml`, branch/channel `preview`, runtimeVersion `1.0.0`). Native rebuild only for native changes.
- **Appetize** (browser emulator): app publicKey `5fp4jgoj5ejuwfnwiqezrsky4q`. The current APK
  has `fallbackToCacheTimeout` so it fetches the latest OTA on launch → refresh + Start shows latest.

## How work is done (no website UIs needed)
All driven via `gh` CLI + GitHub Actions, with keys as **encrypted GitHub secrets**:
`RENDER_API_KEY`, `NEON_API_KEY`, `EXPO_TOKEN`, `SWEEP_TOKEN`, `APPETIZE_TOKEN`.
- Edit code: read/write files via `gh api .../contents/...` (or git data API for atomic multi-file commits).
- **Run SQL (no Neon UI):** `gh workflow run ops.yml -f action=sql -f query="..."` then read the run log. Other ops actions: status/render-*/expo-builds/neon-status.
- **Self-healing cron:** `sweep.yml` (every 5 min) → `/api/internal/sweep`: reassigns vanished cleaners, expires stale searches, promotes due scheduled bookings, nudges overrunning washes.
- **Keep-alive:** `keepalive.yml` (monthly) keeps scheduled workflows enabled.
- **Push a new native build to Appetize:** `gh workflow run appetize-sync.yml -f buildId=<eas-build-id>`.
- **Build stamp:** `constants/build.ts` `BUILD_TAG` renders as a blue pill at the TOP of every screen (global overlay in `app/_layout.tsx`). **Bump it to a new random string on EVERY mobile change.** Current: `gold-otter-2208`.

## Features live (all backend-verified; app UIs shipped via OTA)
Book → nearest-cleaner dispatch → accept (OTP) → arrive → start → complete → rate.
Auto-cancel if none found. Live cleaner tracking. Ratings roll up. Pricing by vehicle+wash type.
Plus: **packages/subscriptions** (1wk/15d/1mo/6mo/1yr, rising 5→30% discount, prepaid, covered bookings ₹0) with a **dummy card/UPI/net-banking payment screen** (`app/pay.tsx`); **scheduled bookings** (preset chips); **edit booking** before accept; **in-app chat** (customer↔cleaner); **stop cleaning** mid-wash by EITHER party → prorated by time spent (30min exterior / 45min full SLA, washer nudged if over); **find a new cleaner** if the assigned one ghosts (re-search, no charge); **start/end times** in booking detail. Stop (charged) is a DISTINCT button from Cancel (free). Merged washer online/offline into ONE clear toggle.

## Auth / testing notes
- Login via phone OTP; **master OTP `1111` works for ANY phone** (dev bypass since SMS isn't configured). ⚠️ PRE-LAUNCH BLOCKER — gate to dev-only once a Fast2SMS key is added.
- Test with throwaway accounts (`*@carcleanpro.test`, phones `+9190000000xx`); delete them after via the `sql` ops action.
- Sessions use in-memory MemoryStore → users get logged out on each redeploy (optional fix: `connect-pg-simple`).

## Known remaining (optional)
SMS OTP + close the `1111` backdoor (needs Fast2SMS key); DB-backed session store; rotate the API keys that passed through chat; surface start/end times on the history LIST (currently on booking detail only).
