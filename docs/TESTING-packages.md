# Testing the daily-package system (thoroughly, in minutes)

Packages are **time-based** (daily washes, weekly billing, 3-day grace, expiry). In
production the sweep cron (`.github/workflows/sweep.yml`) fires every 5 min, so things
progress on their own — but you'd wait days to see weekly billing or grace. These
**token-gated test endpoints** let you fast-forward time and drive every path in seconds.

## Setup

```bash
BASE=https://carcleanpro-api.onrender.com
TOKEN=<the SWEEP_TOKEN value>   # Render dashboard → carcleanpro-api → Environment, or the GitHub repo secret SWEEP_TOKEN
H="-H x-sweep-token:$TOKEN -H Content-Type:application/json"
```

Phone verification OTP bypass is **`1111`**. The wash-start OTP is shown to the owner in
the app (Active Requests → the wash → "Your OTP").

### Test endpoints (all under `/api/internal`, all need `x-sweep-token`)

| Call | What it does |
|---|---|
| `POST /internal/sweep` | Runs the dispatch + billing sweep once (the thing the cron does). |
| `GET /internal/test/packages` | Recent daily packages (id, status, cleanerId, dailyMinutes…). |
| `GET /internal/test/cleaners` | Washers (id, availableSlots, rate) — to get a `cleanerId`. |
| `GET /internal/test/package/:id` | Full state dump: package + every day + every bill. |
| `POST /internal/test/package/:id/shift` `{days}` | **Time-travel**: moves the whole package back N days (start/end, every day, every bill). Accepts fractions (`0.01` ≈ 14 min). |
| `POST /internal/test/package/:id/bind` `{cleanerId}` | Bind a washer without the accept flow (sets rate, stamps all days). |
| `POST /internal/test/package/:id/complete-days` `{count}` | Mark the earliest N open days `completed` (simulate washes done). |

> After **any** state change, run `POST /internal/sweep` to let the engine react, then
> `GET /internal/test/package/:id` to verify.

---

## Scenario playbook

### 0. Prep a "previous washer"
On the washer phone: set working-hours slots (dashboard → Set working hours). Do **one
normal ad-hoc wash** for your owner account (book → accept → arrive → OTP `1111` → start →
complete). That washer is now a "previous washer" the owner can re-request.
Get his id: `curl $BASE/api/internal/test/cleaners $H`.

### 1. Create + first-day dispatch + bind (accept-driven)
- Owner app → **Start a daily package**: pick a daily time a few minutes ahead, Weekly,
  Auto-assign (or a specific washer). Confirm.
- `curl $BASE/api/internal/test/packages $H` → note the package `id` (status `active`, `cleanerId:null`).
- Wait for its time (or `shift {days:0.01}` to pull day-1 into the past), then
  `POST /internal/sweep`.
- **Verify:** the washer phone gets the request (even if his **toggle is OFF** — scheduled
  is slot-based). He accepts → `GET /test/package/:id` shows `package.cleanerId` set and
  every remaining day stamped with that cleanerId.

### 2. Run a package day (OTP)
- When a day is `accepted`, the owner sees it in **Active Requests**. Washer: arrive → owner
  taps **Share OTP** → washer enters OTP → start → complete.
- **Verify:** the owner's booking screen shows *"No payment today — billed weekly"* (not a
  cash prompt); the day is `completed` in the dump.

### 3. Weekly bill generation
- `POST /internal/test/package/:id/bind {"cleanerId":<id>}` (if not already bound).
- `POST /internal/test/package/:id/complete-days {"count":5}` (simulate 5 washes done).
- `POST /internal/test/package/:id/shift {"days":8}` (make the first week fully elapsed).
- `POST /internal/sweep`.
- **Verify:** dump shows a **bill for week 1** = `washesCount:5, amountDue:5×rate, status:due`.
  Owner gets "₹X due", washer gets "you'll receive ₹X".

### 4. Mark paid (either side — P3)
- Owner app → package → **Mark paid** on the week (or washer → *Packages You Serve* →
  **Payment received**).
- **Verify:** dump shows that bill `status:paid`; the other party gets a "paid" push.

### 5. Skip a day / no-show → auto-extend
- Owner (or washer) app → package → a day → **Cancel** (or **No-show** on a past assigned day).
- **Verify:** dump shows that day `cancelled`, `washesTotal` +1, and a new `scheduled`
  make-up day appended at the end (`expiresAt` pushed out a day).

### 6. No washer available → make-up day (M2)
- Create a package whose slot **no washer covers** (all washers offline *and* out of range,
  or set the daily time to a slot none of your test washers works — but note no-slots washers
  are treated as all-day, so use a washer *with* a narrow slot set that excludes this time).
- `POST /internal/sweep` (promotes the day to `searching`), then
  `POST /internal/test/package/:id/shift {"days":0.01}` (pushes it past the 5-min window),
  then `POST /internal/sweep`.
- **Verify:** the searching day is `cancelled` (notes `no_washer`), a make-up day is added,
  and the owner gets "No washer today — added a make-up day."

### 7. Overdue → reminder → auto-cancel + settlement (grace)
- From step 3 (a `due` week bill), `POST /internal/test/package/:id/shift {"days":2}` then
  `sweep` → owner reminded, washer asked to continue (`remindedAt` set).
- `shift {"days":2}` again (now past dueDate = weekEnd+3) then `sweep`.
- **Verify:** package `status:cancelled`, remaining days dropped, **and** a settlement bill
  exists for any completed-but-unbilled washes (M4). Both parties get an "overdue" push.

### 8. Package end → settle final + expire + renewal (M3, P9)
- Bind, `complete-days` for the **whole** duration, then `shift {"days": duration+1}`, `sweep`.
- **Verify:** because no day is still open, the package flips to `status:expired`, the final
  wash is **billed** (not lost), and the owner gets the **renewal** push.
- Regression check for M3: with a 7-day package, confirm the 7th wash **is** in a bill.

### 9. Cancel mid-package → settlement bill (P2)
- Bind, `complete-days {"count":3}`, then owner app → package → **Cancel package**.
- **Verify:** package `cancelled`, remaining days dropped, and a **settlement bill** for the
  3 done washes (`amountDue:3×rate, due`).

### 10. Preferred washer paths (P5/P7)
- **Accept:** owner picks a specific online previous washer → `sweep` → only he is asked → he accepts → bound.
- **Offline reach:** toggle that washer **off**, make sure the package time is in his slots →
  `sweep` → he still gets the request (5-min window).
- **Decline / timeout → generic:** he declines (or `shift {"days":0.01}` + `sweep` to time out)
  → dump shows `preferredCleanerId` cleared and the day broadcast to anyone (generic).

### 11. Toggle only gates ad-hoc
- Washer **toggle OFF**. Owner books an **instant** wash → washer is **not** dispatched.
- Owner books a **scheduled/package** wash in his slot → washer **is** reached. ✅

### 12. Double-booking guards (H1/H2)
- **H1:** bind washer W to a package at 09:00. Give W a live ad-hoc job (accept one, leave it
  `in_progress`). `shift` the package day to now, `sweep`. **Verify:** the package day stays
  `scheduled` (not a second `accepted` job) and gets picked up on a later sweep once W is free.
- **H2:** create two packages both requesting W at the **same** daily time. Accept both day-1.
  **Verify:** only the first binds (`cleanerId` set); the second package's `cleanerId` stays
  `null` (W still served that one day, but isn't locked to both).

---

## Tips
- `GET /internal/test/package/:id` is your source of truth — check `status`, each day's
  `status/cleanerId/completedAt`, and every bill's `washesCount/amountDue/status/dueDate`.
- `shift` is reversible: shift back with a negative `days` to undo.
- These endpoints are **token-only** and unused by the app; leave them, or remove the
  `/internal/test/*` block later if you want them gone from production.
