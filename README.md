# SINAI Club

Live at https://sinaiclub.com (GitHub Pages, custom domain).

- `/` — marketing site (`index.html`, `assets/`). `/#site` always shows the site; signed-in users are sent to `/app/`.
- `/app/` — the coach / family app (PWA). Its service worker `app/sw.js` has scope `/app/`; bump `V` there when app files change.
- `/sw.js` — leftover root worker from before the move; it unregisters itself and sends old app windows to `/app/`.
- Languages (he default, en, ru, ar, es, de, fr, it, pt): `app/i18n.js` translates the rendered page from dictionaries keyed by the Hebrew source text — `app/i18n/<lang>.js` (app UI + drill library) and `app/i18n/parents.<lang>.js` (`/parents/` pages). Write UI in Hebrew as before, then add the new strings to the eight dictionaries; anything missing stays Hebrew. User data (names, notes) is never translated; mark such elements `translate="no"`. Choice is stored in `localStorage['sg-lang']` (shared with the marketing site). After changing any app file, update its `?v=` hash in `app/index.html` (first 8 hex of md5) and bump `V` in `app/sw.js`.
- `supabase/functions/coach-auth` — Edge Function. Backend settings live in `app/config.js`.

Brand: palette "כחול קבוצה" (#0D1F4F, #1E45B0, #4D7CF0, lime #B9EE3E for main CTAs only), logo `assets/icon.svg`.
