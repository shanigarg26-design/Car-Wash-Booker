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
**actions:** `status` (Render deploys + Expo builds) · `render-service` · `render-deploys` · `render-logs` · `expo-builds` · `neon-status`
(optional `-f limit=20`)

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
Secrets, not in the repo. Rotate all keys periodically (they passed through chat during setup).
