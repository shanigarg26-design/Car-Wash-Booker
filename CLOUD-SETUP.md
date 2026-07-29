# CarCleanPro — Cloud Setup & Live-Update Plan

> **Purpose of this file:** the owner wants the app fully in the cloud — **no dependency on any
> local laptop or folder** — installed once on an Android phone, then **auto-updating over-the-air**
> whenever code changes (no reinstalls). Replit has been abandoned. This document is the agreed plan
> and the handoff notes for a cloud Claude Code session (claude.ai/code) to execute.

## Goal (owner's words)
- Code lives in the cloud (this GitHub repo). No local machine involvement for running or editing.
- One-time install of a custom Android app; after that it **pulls the latest JS from the cloud on every open**.
- Full stack runs in the cloud. Login works via phone OTP (dev-bypass code `1111` until SMS is configured).

## Architecture (all free tiers)
```
  Claude (claude.ai/code) --push--> GitHub --------> Render (Express API, always-on)
                                       |                  |
                                       |                  +-- reads/writes --> Neon (PostgreSQL)
                                       |
                                       +--> GitHub Action --> EAS Update (Expo cloud) --> Android app (auto-pulls)
```
| Piece | Service | Role |
|-------|---------|------|
| Code + automation | **GitHub** (private) | source of truth; triggers deploys/updates |
| Database | **Neon** | PostgreSQL (`DATABASE_URL`) |
| API server | **Render** | runs `artifacts/api-server` 24/7 (uses in-memory dispatch timers, so NOT serverless) |
| App build + OTA updates | **Expo EAS** | builds the Android app; `eas update` delivers live JS changes |

## Repo facts (already true)
- pnpm workspace monorepo. Node 24. Packages: `artifacts/api-server` (Express 5), `artifacts/car-wash-mobile` (Expo SDK 54 / RN), `lib/db` (Drizzle+Postgres), plus generated `lib/api-*`.
- API entry: `artifacts/api-server/src/index.ts` — **requires `PORT`**; builds via `build.ts` (esbuild) to `dist/index.cjs`.
- DB reads `process.env.DATABASE_URL` (`lib/db/src/index.ts`); schema push: `pnpm --filter @workspace/db run push-force`.
- Mobile API base: `EXPO_PUBLIC_API_BASE` in `artifacts/car-wash-mobile/.env` (currently a dead Replit URL — must point to the Render URL).
- Google OAuth secret read from `process.env.GOOGLE_CLIENT_SECRET` / `GOOGLE_CLIENT_ID`.

## Already done (in this commit)
- Removed `.replit` from git tracking and git-ignored it + all `.env` files (secrets no longer pushed).
- ⚠️ **Rotate the Google OAuth client secret** in Google Cloud Console — the old one was committed to git history. Then set the new value only in Render's env (never in the repo).

## Remaining steps (cloud Claude executes; owner only creates accounts + taps install)

### 1. Database — Neon
- Owner: create a Neon project, copy the connection string.
- Store it as the `DATABASE_URL` **secret in Render** (below) and in the GitHub Action secrets if migrations run in CI.
- Run once to create tables: `DATABASE_URL=... pnpm --filter @workspace/db run push-force`.

### 2. API server — Render (Blueprint `render.yaml` to add at repo root)
```yaml
services:
  - type: web
    name: carcleanpro-api
    runtime: node
    plan: free
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build
    startCommand: node artifacts/api-server/dist/index.cjs
    healthCheckPath: /api/healthz
    envVars:
      - { key: NODE_VERSION, value: "24" }
      - { key: DATABASE_URL, sync: false }        # Neon string (secret)
      - { key: SESSION_SECRET, generateValue: true }
      - { key: GOOGLE_CLIENT_ID, sync: false }
      - { key: GOOGLE_CLIENT_SECRET, sync: false } # rotated value
      - { key: FAST2SMS_API_KEY, sync: false }     # optional; without it OTP dev-mode + code 1111
```
- Render sets `PORT` automatically (index.ts reads it). Note: free plan cold-starts after ~15 min idle.
- After deploy, note the public URL, e.g. `https://carcleanpro-api.onrender.com`.

### 3. Mobile app — Expo EAS (build once + OTA updates)
- Set `EXPO_PUBLIC_API_BASE` = the Render URL (via EAS env / `.env` at build time).
- `eas init` (creates project id in `app.json`), add `expo-updates`, set `app.json`:
  - `runtimeVersion: { "policy": "appVersion" }`, `updates.url` (added by `eas init`).
- Build the installable Android app: `eas build -p android --profile preview` → owner installs the APK/link once.
- Publish updates: `eas update --channel preview --non-interactive`.

### 4. Automation — GitHub Action `.github/workflows/eas-update.yml`
- On push to `main`: checkout → pnpm install → `eas update --channel preview --non-interactive`.
- Needs repo secret `EXPO_TOKEN` (from expo.dev → Access Tokens).
- Result: **every push → phone gets the new JS on next open. No reinstall.**

## Ongoing loop
`edit in claude.ai/code → commit/push → GitHub Action runs eas update → reopen app on phone → latest is live.`
Native-dependency changes are the only case needing a new `eas build` + reinstall (rare).
