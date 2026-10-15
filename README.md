# SINAI Club

Live at https://sinaiclub.com (GitHub Pages, custom domain).

- `/` — marketing site (`index.html`, `assets/`). `/#site` always shows the site; signed-in users are sent to `/app/`.
- `/app/` — the coach / family app (PWA). Its service worker `app/sw.js` has scope `/app/`; bump `V` there when app files change.
- `/sw.js` — leftover root worker from before the move; it unregisters itself and sends old app windows to `/app/`.
- Languages (he default, en, ru, ar, es, de, fr, it, pt, hi): `app/i18n.js` translates the rendered page from dictionaries keyed by the Hebrew source text — `app/i18n/<lang>.js` (app UI + drill library) and `app/i18n/parents.<lang>.js` (`/parents/` pages). Write UI in Hebrew as before, then add the new strings to the nine dictionaries; anything missing stays Hebrew. User data (names, notes) is never translated; mark such elements `translate="no"`. Choice is stored in `localStorage['sg-lang']` (shared with the marketing site). After changing any app file, update its `?v=` hash in `app/index.html` (first 8 hex of md5) and bump `V` in `app/sw.js`.
- `supabase/functions/coach-auth` — Edge Function. Backend settings live in `app/config.js`.

Brand: palette "כחול קבוצה" (#0D1F4F, #1E45B0, #4D7CF0, lime #B9EE3E for main CTAs only), logo `assets/icon.svg`.

3.0 additions:
- `app/build.js` — "בנה לי אימון": a session from the team's weakest attributes (last 4 weeks), age profile and session length, one reason per drill.
- `app/reports.js` + `app/report-view.js` — monthly progress report (AI sentence via `supabase/functions/coach-ai`, approved by the coach), PDF and a private link `/r/?t=…`.
- `app/goals.js` — personal development plan: up to 3 attribute goals per season, progress from the ratings (`coach_kid_goals` for the family).
- `app/threads.js` — conversations per player; the database (`coach_msg_guard`) puts the registered parents in every conversation with a minor and keeps `coach_messages` append-only.
- `app/voice.js` — rating by voice ("יוסי מסירה 4") with a confirmation screen (`coach-voice` mode `rate`).
- `assets/currency.js` + `assets/pricing.js` — currency picker with live rates from `supabase/functions/fx-rates` (OXR_APP_ID for hourly Open Exchange Rates; otherwise ECB). The pricing section stays hidden until `PUBLISHED = true` in pricing.js; preview with `?pricing`.
- Branded intro: inline right after `<body>` in every home page and the app; source `assets/intro.src.js`.
- Database changes: `supabase/migrations/20261015_3_0_features.sql`.
