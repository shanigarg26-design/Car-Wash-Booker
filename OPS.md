# Ops — control the infrastructure via API (no UI, any device)

All service keys are stored as **encrypted GitHub Actions secrets** (never committed to the repo):
`RENDER_API_KEY`, `EXPO_TOKEN`, `NEON_API_KEY`. They're usable by workflows only — invisible/unreadable otherwise.

## Troubleshoot from anywhere (phone or laptop), no dashboards
The `ops.yml` workflow fetches status/logs via the service APIs using those secrets:
```bash
# run it
gh workflow run ops.yml --repo shanigarg26-design/Car-Wash-Booker -f action=status
# find the run + read output
gh run list --repo shanigarg26-design/Car-Wash-Booker --workflow ops.yml -L1
gh run view <run-id> --repo shanigarg26-design/Car-Wash-Booker --log
```
**actions:** `status` (Render deploys + Expo builds) · `render-service` · `render-deploys` · `render-logs` · `expo-builds` · `neon-status` · `sql`
(optional `-f limit=20`)

## Run SQL against the live DB — no Neon UI, no credential in chat
```bash
gh workflow run ops.yml --repo shanigarg26-design/Car-Wash-Booker \
  -f action=sql -f query="select id, name, email, role, is_logged_in from users order by id;"
# then read the result rows:
gh run list --repo shanigarg26-design/Car-Wash-Booker --workflow ops.yml -L1
gh run view <run-id> --repo shanigarg26-design/Car-Wash-Booker --log
```
The `sql` step reads `DATABASE_URL` **live from Render's env vars** (via `RENDER_API_KEY`) and runs
`psql` on the runner — the connection string never leaves the runner and is masked in logs. This is
why no `NEON_DATABASE_URL` secret is needed and the DB password never has to pass through chat.

## Direct API (interactive, only when a key value is on hand this session)
- **Render:** `curl -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/srv-d9kr4fijnfac739oerk0/deploys?limit=5`
- **Expo:** EAS GraphQL `https://api.expo.dev/graphql` (Bearer $EXPO_TOKEN), appId `d4b8d786-3cf7-4a02-acbf-d9405f07ce48`
- **Neon:** `curl -H "Authorization: Bearer $NEON_API_KEY" "https://console.neon.tech/api/v2/projects?org_id=org-billowing-cell-76962707"`
- **GitHub:** `gh` CLI (authenticated; scopes repo + workflow)
- **Appetize:** REST API (see [[eas-build-expo-router-fix]] memory) for running the APK in a browser emulator.

## Key IDs
- Render service: `srv-d9kr4fijnfac739oerk0`  (carcleanpro-api)
- EAS project: `d4b8d786-3cf7-4a02-acbf-d9405f07ce48`  (slug `shani-garg`, owner `shanigarg26s-team`)
- Neon: org `org-billowing-cell-76962707`, project `royal-mud-88588731`  (Car Wash Booker)

## Note
The safety system blocks handling raw secret *values* (DB passwords, extracting keys from pages).
So: creating keys + storing them as secrets is fine; using them via workflows/curl is fine; but
**reading a secret value back is intentionally impossible** — that's why keys live in GitHub Actions
Secrets, not in the repo. The `sql` action above is designed around this: the DB URL is read on the
runner and never handled in chat.

## Key rotation status (2026-07-30)
- **Google OAuth client secret** — ROTATED. New secret set in Render (`GOOGLE_CLIENT_SECRET`),
  verified working, and the old exposed secret (`****sLiK`, leaked in public git history) was
  **disabled and deleted** in the Google console. Only the new secret exists now.
- **DB password** — NOT rotated (not needed): the connection string never passed through chat
  (the safety classifier blocked it every time), so it was never exposed. SQL is now no-UI via the
  `sql` action, which reads the URL from Render at runtime.
- **Neon API key** — ROTATED (2026-07-30). Done fully via Neon's API: new key created, `NEON_API_KEY`
  secret updated (piped, value never printed), old key `3228695` revoked (now 401). Verified via a
  `neon-status` run. The Neon key pasted in chat during setup is dead.
- **Render API key** — regenerate in the Render dashboard (Account Settings → API Keys), then update
  the `RENDER_API_KEY` GitHub secret (github.com → repo → Settings → Secrets and variables → Actions).
  Render has NO API for key management, so this step is UI-only (doable from a phone browser).
- **Appetize token** — regenerate in Appetize account settings. It is NOT stored as a GitHub secret
  (was only used ad-hoc for the emulator), so nothing else to update; regenerating kills the old one.
