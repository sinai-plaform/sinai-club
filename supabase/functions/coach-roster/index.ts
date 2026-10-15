// SINAI Club — coach-roster (2.9.0)
// Reads a registration list the coach got from the community centre / school — a scanned PDF page,
// a photo, or the text of a digital PDF / spreadsheet — and returns one structured row per child:
// name, parent, phone, birth date, grade, and the group / team the child is registered to.
// Nothing is stored here: the page lives only inside this request. The app shows the rows for
// review and writes players, parents and teams itself (under the coach's own permissions).
// Provider (same secrets as coach-voice):
//   GROQ_API_KEY   — free tier. Vision: qwen multimodal; text: gpt-oss-120b.
//   OPENAI_API_KEY — paid fallback (gpt-4.1-mini reads images and text).
// Optional overrides: ROSTER_VISION_MODEL, ROSTER_TEXT_MODEL.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GROQ = Deno.env.get('GROQ_API_KEY') || '';
const OAI = Deno.env.get('OPENAI_API_KEY') || '';

type Provider = { base: string; key: string; vision: string[]; text: string[] };
const PROVIDERS: Provider[] = [];
if (GROQ) PROVIDERS.push({
  base: 'https://api.groq.com/openai/v1', key: GROQ,
  vision: [Deno.env.get('ROSTER_VISION_MODEL') || '', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 'meta-llama/llama-4-scout-17b-16e-instruct'].filter(Boolean),
  text: [Deno.env.get('ROSTER_TEXT_MODEL') || '', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'].filter(Boolean),
});
if (OAI) PROVIDERS.push({ base: 'https://api.openai.com/v1', key: OAI, vision: ['gpt-4.1-mini'], text: ['gpt-4.1-mini'] });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SHAPE = `{"page":{"activity":"","group":"","columns":[]},"rows":[{"player":"","parent":"","phone":"","phone2":"","birth":"","grade":"","group":"","school":"","note":""}]}`;

const SYSTEM = (teams: string[], hint: string) => `
You read a registration list of a children's football (soccer) school, usually in Hebrew, often a scanned or photographed
table (it may be skewed, rotated, low quality, handwritten in places, or split across columns). Extract EVERY registered child.

For each child return one row:
- player: the child's full name exactly as written. If first and last name are in separate columns, join them "first last"
  (Hebrew order: first name, then family name). Never translate or "fix" names.
- parent: the parent's / guardian's name if present, else "".
- phone: the parent's mobile number as written (Israeli numbers usually start with 05). If there are two numbers, the first
  mobile goes here and the other in phone2. Digits only matter; keep dashes as written.
- birth: the birth date as YYYY-MM-DD. Israeli dates are DAY/MONTH/YEAR (12/03/2016 = 2016-03-12). If only a birth year is
  written, birth is "" and note is "שנתון YYYY". If there is no birth date, "".
- grade: the school grade as written ("ה׳", "ה", "5", "גן חובה", "כיתה ג"), else "".
- group: the group / team / class / training slot the child is registered to, exactly as written — a column such as
  "קבוצה", "חוג", "מסגרת", "שכבה", "שעה", "יום", or a section heading / page title that the child's row sits under
  (apply a heading to every row below it until the next heading). If the list has no grouping at all, "".
- school: the child's school if a column has it, else "".
- note: anything else short and useful on that row (medical note, "אח של…", payment status), else "".

Common format — the community centre (מתנ"ס) participants report, "דו"ח משתתפים בקבוצות":
- The page header has "שם החוג" (the activity, e.g. בי"ס לכדור רגל — NOT the group) and "שם הקבוצה" (the group, e.g.
  "כדורגל גן", "כדורגל ג׳-ד׳"). group = the value after "שם הקבוצה:" for every child on that page.
- Columns from the right: "משפחה" (family name), "פרטי" (first name), then registration period, balance, paid, discount —
  ignore the money and the dates of the registration period.
- Under each child there is a second line "כתובת: <address> טל: <phone> <phone>". The phone(s) come from there.
  The address is NOT a group, NOT a grade and NOT a note.
- player = first name + space + family name ("פרטי משפחה"), e.g. family "לביא", first "דוד" → "דוד לביא".
- A number inside an address or a house number is never a grade. grade only if a grade column or "כיתה" is written.

Hebrew reading: letters that look alike in print and scans (ה/ח/ת, ד/ר/ך, ו/ז/ן, ב/כ, ס/ם, ע/צ, י/ו) — read each carefully.
These are real Israeli first and family names; when a letter is unclear, prefer the reading that is a real name.

Page fields: page.activity = the value after "שם החוג:" (or the list's title), page.group = the value after "שם הקבוצה:"
(or a group heading for the whole page), exactly as printed; page.columns = the table's column headers, right to left.
Copy page.group into every row's group unless the row sits under its own heading.

Rules:
- Skip header rows, totals, page numbers, signatures, empty rows and crossed-out rows.
- Read Hebrew right to left: the first column is on the RIGHT.
- Do not invent data. If a cell is unreadable, leave that field "" (but still return the child if the name is readable).
- Keep the order of the list.
${teams.length ? `The coach's existing teams (for reference only — copy the group as written in the list, do not map it): ${teams.join(' | ')}` : ''}
${hint ? `Context from the app: ${hint}` : ''}

Reply with JSON only, in exactly this shape: ${SHAPE}`;

function clean(content: string) {
  let s = String(content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

async function ask(kind: 'vision' | 'text', system: string, user: unknown, prefer = '') {
  const errors: string[] = [];
  for (const p of PROVIDERS) {
    for (const model of (prefer && p === PROVIDERS[0] ? [prefer, ...p[kind]] : p[kind])) {
      const base = { model, temperature: 0, max_tokens: 8000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      // some models refuse a parameter the next one needs — try the richest request first
      const tries = [
        { ...base, response_format: { type: 'json_object' }, reasoning_format: 'hidden' },
        { ...base, response_format: { type: 'json_object' } },
        base,
      ];
      for (const body of tries) {
        const r = await fetch(`${p.base}/chat/completions`, {
          method: 'POST', headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          try { return { model, out: clean(j.choices?.[0]?.message?.content) }; }
          catch { errors.push(`${model}: not JSON`); break; }
        }
        const msg = String(j?.error?.message || r.status);
        errors.push(`${model}: ${msg}`);
        // a missing / retired model → next model; a rejected parameter → same model, simpler request
        if (r.status === 404 || /model|decommission|not found|does not exist|not support.*image/i.test(msg) && !/param|format|reasoning/i.test(msg)) break;
        if (r.status === 429 || r.status >= 500) break;
      }
    }
  }
  throw new Error('הקריאה נכשלה — ' + errors.slice(-3).join(' · '));
}

const S = (v: unknown, n = 80) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!PROVIDERS.length) return json({ error: 'חסר מפתח GROQ_API_KEY בהגדרות השרת' }, 500);

  // only a signed-in coach of a club
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(SB_URL, SRK, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'לא מחובר' }, 401);
  const { count } = await admin.from('coach_members').select('user_id', { count: 'exact', head: true })
    .eq('user_id', u.user.id).in('role', ['coach', 'assistant', 'manager']);
  if (!count) return json({ error: 'רק מאמנים' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'בקשה לא תקינה' }, 400); }
  if (body.models) {   // diagnostics: which models the provider offers right now
    const p = PROVIDERS[0];
    const r = await fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${p.key}` } });
    const j = await r.json().catch(() => ({}));
    return json({ models: (j.data || []).map((m: any) => m.id) });
  }
  const teams: string[] = (body.teams || []).slice(0, 60).map((t: unknown) => S(t, 60)).filter(Boolean);
  const hint = S(body.hint, 300);
  const images: string[] = (body.images || []).slice(0, 2);
  const text = String(body.text || '').slice(0, 60_000);
  if (!images.length && !text.trim()) return json({ error: 'אין מה לקרוא' }, 400);
  if (images.some((b) => b.length > 5_500_000)) return json({ error: 'הדף גדול מדי' }, 413);

  try {
    const system = SYSTEM(teams, hint);
    const user = images.length
      ? [{ type: 'text', text: 'Registration list page(s). Extract every child.' },
         ...images.map((b) => ({ type: 'image_url', image_url: { url: b.startsWith('data:') ? b : `data:image/jpeg;base64,${b}` } }))]
      : 'Registration list (text extracted from a file; columns separated by tabs, right-to-left order may be scrambled):\n\n' + text;
    // with on-device OCR text, the text model reads the page (its letters are exact); the image is used only
    // to repair the few names the OCR could not read
    const useText = !!text.trim();
    const { model, out } = await ask(useText ? 'text' : 'vision', system,
      useText ? (body.ocr
        ? 'Registration list (OCR text of one scanned page, line by line; Latin fragments are OCR failures — return the row anyway with what is readable):\n\n'
        : 'Registration list (text extracted from a file; columns separated by tabs, right-to-left order may be scrambled):\n\n') + text : user,
      S(body.model, 80));
    if (useText && images.length && Array.isArray(out?.rows)) {
      const bad = out.rows.map((r: any, i: number) => ({ i, r })).filter(({ r }) => /[A-Za-z]/.test(String(r.player || '')) || !/\s/.test(String(r.player || '').trim()));
      if (bad.length) {
        try {
          const fix = await ask('vision',
            'You fix names in a Hebrew registration list. For each listed row, read the child\'s first name and family name from the image ' +
            '(the row is identified by the phone number printed under it, and by the readable part of the name). Columns from the right: ' +
            'family name, first name. Return JSON only: {"fix":[{"i":0,"player":"first family"}]} with the same i values. Copy Hebrew exactly; if unreadable, keep the given text.',
            [{ type: 'text', text: JSON.stringify(bad.map(({ i, r }) => ({ i, player: r.player, phone: r.phone }))) },
             { type: 'image_url', image_url: { url: images[0].startsWith('data:') ? images[0] : `data:image/jpeg;base64,${images[0]}` } }]);
          for (const f of (fix.out?.fix || [])) {
            const r = out.rows[+f.i]; const p = S(f.player, 60);
            if (r && p && /[א-ת]/.test(p) && !/[A-Za-z]/.test(p)) r.player = p;
          }
        } catch { /* keep the OCR reading; the coach can edit it */ }
      }
    }
    const page = out?.page || {};
    const pageGroup = S(page.group, 60), activity = S(page.activity, 60);
    const cols = (Array.isArray(page.columns) ? page.columns : []).map((c: unknown) => S(c, 40)).join(' ');
    const gradeCol = /כית|שכב|grade|class/i.test(cols) || !cols;   // a grade only when the table has a grade column
    const rows = (Array.isArray(out?.rows) ? out.rows : []).map((r: any) => ({
      player: S(r.player, 60), parent: S(r.parent, 60), phone: S(r.phone, 24), phone2: S(r.phone2, 24),
      birth: /^\d{4}-\d{2}-\d{2}$/.test(S(r.birth, 10)) ? S(r.birth, 10) : '',
      grade: gradeCol ? S(r.grade, 20) : '', school: S(r.school, 60), note: S(r.note, 120),
      // the activity name ("בי"ס לכדור רגל") or an address is never the group; the page's group wins then
      group: (() => { const g = S(r.group, 60);
        if (pageGroup && (!g || (activity && (activity.includes(g) || g.includes(activity))) || /כתובת|רחוב|חוג/.test(g) || !/[\p{L}]/u.test(g))) return pageGroup;
        return g; })(),
    })).filter((r: any) => r.player && /[\p{L}]/u.test(r.player));
    return json({ rows, model, page: { group: pageGroup, activity, columns: cols } });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
