# Swish Ground v2 — deployment

A Node backend on Render reading your three sheets live, and a one-file frontend on GitHub Pages. Attendance only; Performance and Analytics show "under maintenance".

## What's in here

```
server.js      Express app + routes
sheets.js      Google Sheets/Drive access, read cache
roster.js      joins NCR Team + FTE All into one view per person
poas.js        today's venues for a BDE (via manager) or TL (direct)
handlers.js    login, token auth, bootstrap
submit.js      photo → Drive, append attendance row
admin.js       present counts by total / region / TL
public/index.html   the app
render.yaml    Render config with your 4 sheet IDs baked in
```

The three source sheets are read-only to the app. It writes only to the attendance sheet.

## Step 1 — Put the backend on GitHub

Create a repo (private is fine for the backend — Render reads it with your permission). Upload everything **except** `public/`. Or upload all of it; the frontend file is harmless there.

## Step 2 — Deploy on Render

1. render.com → New → Web Service → connect the repo.
2. It reads `render.yaml` and fills most settings. Confirm: Build `npm install`, Start `node server.js`, Plan Free.
3. Add the secret env vars (render.yaml leaves these blank on purpose):
   - **GOOGLE_CREDENTIALS** — paste the *entire contents* of the service-account JSON key, as one line. This is the private key; Render encrypts it.
   - **PHOTO_FOLDER_ID** — a Drive folder for login photos. Create one, share it Editor with `swish-server@swish-ground.iam.gserviceaccount.com`, copy its ID from the URL.
   - **TOKEN_SECRET** — any long random string. Generate one: `openssl rand -base64 32`.
   - **ADMIN_PW** — the admin password (defaults to `swish@246` if unset).
4. Deploy. You get a URL like `https://swish-ground.onrender.com`.

**Free plan note:** Render sleeps the service after 15 min idle, so the first request after a lull takes ~30s to wake. Fine for a pilot. A paid instance ($7/mo) stays warm.

## Step 3 — Point the frontend at Render

In `public/index.html`, line ~ `var API =`, replace `REPLACE_WITH_RENDER_URL` with your Render URL (no trailing slash).

## Step 4 — Host the frontend on GitHub Pages

New repo, upload `index.html` (renamed from public/index.html, kept at root). Settings → Pages → Deploy from branch → main → / root. Your app URL appears in a minute.

## Step 5 — Check it

- Backend health: open `https://your-render-url/health` → every check `ok`.
- Resolved roster: `https://your-render-url/debug/roster` → counts by role/region, who has no email, no WR code, any shared mobiles. **This is your data-quality list.**
- App: open the Pages URL on your phone, sign in.

## Logins

- **BDE / TL** — work email + mobile number as password. A BDE with no WR code in the roster is asked for one on the attendance screen.
- **Admin** — `admin` / your ADMIN_PW. Sees cumulative attendance by region and TL, with a date range.

## What to watch on the first real submit

- A photo appears in the Drive folder.
- A row appears in the attendance sheet with name, POA, pod, WR code, photo link, and GPS.
- The admin view counts it.

## The data-quality link that matters

Open `/debug/roster` before onboarding anyone. It tells you:
- **no_email** — these people can only log in by mobile-as-id until an email is added to FTE All.
- **no_wr_code** — these are asked for a code at submit (by design), but filling the roster is cleaner.
- **shared_mobiles** — two people with one number; one of them can't log in until it's unique.

Fixing those in the source sheets flows through on the next request — no redeploy.
