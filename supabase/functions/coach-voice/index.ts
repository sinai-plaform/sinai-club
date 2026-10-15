// SINAI Club — coach-voice (2.6.0; 3.0: "rate" mode — explicit scores, confirmed by the coach before saving)
// A short voice note from the pitch (hold the mic, speak, let go) → Hebrew transcript →
// structured notes: ratings (attribute + 1–5 score + weight), discipline entries, plain notes.
// The audio is never stored: it lives only inside this request.
// Provider (one secret is enough):
//   GROQ_API_KEY   — free tier (Whisper large-v3 + gpt-oss-120b), no data retention by default. Used first.
//   OPENAI_API_KEY — paid, a little better at Hebrew names.
// Optional overrides: VOICE_STT_MODEL, VOICE_TEXT_MODEL.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GROQ = Deno.env.get('GROQ_API_KEY') || '';
const OAI = GROQ || Deno.env.get('OPENAI_API_KEY') || '';
const BASE = GROQ ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
const STT_MODEL = Deno.env.get('VOICE_STT_MODEL') || (GROQ ? 'whisper-large-v3' : 'gpt-4o-transcribe');
const TEXT_MODEL = Deno.env.get('VOICE_TEXT_MODEL') || (GROQ ? 'openai/gpt-oss-120b' : 'gpt-4.1-mini');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Player = { id: string; name: string; no?: number | null; pos?: string | null; nick?: string | null };
type Attr = { key: string; label: string };

// how the coach talks → numbers. Examples, not a lookup table: the model generalises from them.
const EXAMPLES = `
"מסירה מעולה לעומק" → passing 5 (1), decisions 4 (0.6)
"איבד כדור במסירה" → passing 2 (1)
"החליף אגף יפה" → decisions 4 (1), passing 4 (0.5)
"מסירה ארוכה מדויקת" → long_pass 5 (1)
"הגבהה טובה לרחבה" → crossing 4 (1)
"שיחק בנגיעה אחת" → passing 4 (1), first_touch 4 (0.4)
"החזיק יותר מדי את הכדור" / "לא הרים את הראש" → decisions 2 (1)
"קומבינציה יפה של יואב ואורי" → teamwork 5 (1) for BOTH players (one item, two player_ids)
"קבלה מעולה בתנועה" → first_touch 5 (1); "הכדור ברח לו" / "נגיעה כבדה" → first_touch 2 (1)
"הסתובב יפה תחת לחץ" → first_touch 5 (1), determination 4 (0.3)
"עבר שחקן" → dribbling 4 (1); "עבר שניים" → dribbling 5 (1); "נתקע בכדרור" → dribbling 2 (1), decisions 2 (0.4)
"מכסה את הכדור בגוף" → dribbling 4 (1), strength 4 (0.4)
"שער" / "גמר בנגיעה אחת" → shooting 5 (1), first_touch 4 (0.3)
"בעיטה למסגרת" → shooting 4 (1); "בעיטה מעל" / "החמיץ" → shooting 2 (0.6) — a miss is a normal part of the game, weight 0.6
"פחד לבעוט" → determination 2 (1), shooting 3 (0.3)
"נגיחה טובה" / "ניצח באוויר" → heading 4 (1)
"חטיפה" → tackling 4 (1); "חטיפה ויצא להתקפה" → tackling 5 (1), decisions 4 (0.5); "נכנס מאוחר" → tackling 2 (1)
"חסם בעיטה" / "לא ויתר" → determination 5 (1)
"חזר להגן" → teamwork 5 (1), stamina 4 (0.4); "לא חזר" → determination 2 (1), teamwork 2 (0.5)
"לחץ גבוה טוב" → determination 4 (1), teamwork 4 (0.5)
"איבד את השחקן שלו" → focus 2 (1); "קרא את המשחק" → decisions 5 (1)
"התייאש אחרי טעות" → determination 2 (1); "מנהיג, מדבר עם החברים" → leadership 5 (1)
"מפוזר" / "לא מקשיב בהסבר" → focus 2 (1) or listening 2 (1)
"הכי מהיר" → speed 5 (1); "נגמר לו האוויר" → stamina 2 (1); "זריז" → agility 5 (1); "נפל בכל מגע" → strength 2 (1)
"הצלה" → gk_handling 4 (1); "הצלה כפולה" → gk_handling 5 (1); "יציאה טובה" → gk_positioning 5 (1); "ניהל את ההגנה" → gk_comm 5 (1), leadership 4 (0.4)
"יואב שיחק היום" (overall praise) → decisions 4 (0.5), teamwork 4 (0.4), determination 4 (0.4)
"יותר טוב מבפעם הקודמת ב-X" → X 4 (1)
`;

const SYSTEM = (players: Player[], attrs: Attr[], selected: string | null, ctx: string) => `
You turn a football (soccer) coach's short spoken Hebrew note, recorded during youth training, into structured data.

ROSTER (id | name | nickname | shirt | position):
${players.map((p) => `${p.id} | ${p.name} | ${p.nick || ''} | ${p.no ?? ''} | ${p.pos || ''}`).join('\n')}

ATTRIBUTES this team is rated on (key = label). Use ONLY these keys:
${attrs.map((a) => `${a.key} = ${a.label}`).join('\n')}

${selected ? `The coach tapped player ${selected} before speaking: a note that names nobody is about this player. A name said aloud wins over the tap.` : 'No player was tapped: identify players from the names said.'}
${ctx ? `Context: ${ctx}` : ''}

Return one item per distinct thing said about a player (or the whole team).
- kind "rating": effects = [{attr, score 1–5, weight}]. Main attribute weight 1, secondary 0.2–0.6. Misses weight 0.6.
  Scores: 5 excellent, 4 good, 3 ok, 2 weak, 1 very poor. Intensifiers ("ממש", "מטורף") push toward 5 or 1; softeners ("קצת", "די") toward 3. Negation flips ("לא מסר טוב" = weak).
  Understand free phrasing and slang, not only the examples. Never invent attributes outside the list; if the closest attribute is not in the list, use the next closest that is, or make it a "note".
- kind "discipline": behaviour, not football skill (late, didn't listen, rude, phone, argued, fought, no equipment, left without asking; or positive: helped a friend, sportsmanship, helped with equipment). discipline_kind = short Hebrew label, severity 1–3, positive true/false. No effects.
- kind "note": anything else worth keeping with no score (pain, injury complaint, tired today, attendance). label = short Hebrew. No effects.
- foot: if the note says which foot the player used ("עם שמאל", "ברגל ימין"), set "left"/"right", else "none". Do NOT add extra score for it — the app compares it with the player's real foot.
- Players: player_ids = the players the item is about. If a spoken name matches several roster players (same first name) and nothing disambiguates (surname, nickname, shirt number, the tap), leave player_ids empty and put all matching ids in candidate_ids. If the name matches nobody, both empty.
- who = "team" when the coach speaks about everyone ("כולם", "כל הקבוצה"); then player_ids empty, weights of effects at most 0.3.
- label: a 2–5 word Hebrew summary of the item, as the coach would write it.
- If the transcript contains nothing usable, return items: [].

EXAMPLES (phrase → attr score (weight)):
${EXAMPLES}`;

const SCHEMA = {
  name: 'coach_notes',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['who', 'player_ids', 'candidate_ids', 'kind', 'label', 'effects', 'foot', 'discipline_kind', 'severity', 'positive'],
          properties: {
            who: { type: 'string', enum: ['player', 'team'] },
            player_ids: { type: 'array', items: { type: 'string' } },
            candidate_ids: { type: 'array', items: { type: 'string' } },
            kind: { type: 'string', enum: ['rating', 'discipline', 'note'] },
            label: { type: 'string' },
            effects: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false, required: ['attr', 'score', 'weight'],
                properties: { attr: { type: 'string' }, score: { type: 'integer' }, weight: { type: 'number' } },
              },
            },
            foot: { type: 'string', enum: ['left', 'right', 'none'] },
            discipline_kind: { type: 'string' },
            severity: { type: 'integer' },
            positive: { type: 'boolean' },
          },
        },
      },
    },
  },
};

// ---------- "rate" mode: the coach dictates explicit scores ("יוסי מסירה 4, דני בעיטה 3") ----------
const RATE_SYSTEM = (players: Player[], attrs: Attr[], selected: string | null, ctx: string) => `
A youth football coach dictates explicit ratings on the pitch: player name, attribute, score 1–5.
Example: "יוסי מסירה 4, דני בעיטה 3, אורי כדרור חמש" → three ratings.

ROSTER (id | name | nickname | shirt | position):
${players.map((p) => `${p.id} | ${p.name} | ${p.nick || ''} | ${p.no ?? ''} | ${p.pos || ''}`).join('\n')}

ATTRIBUTES (key = label). Use ONLY these keys; map synonyms and singular/plural to them (מסירה/מסירות/פס → passing, בעיטה/בעיטות/סיום → shooting, קבלה/נגיעה ראשונה → first_touch, etc.):
${attrs.map((a) => `${a.key} = ${a.label}`).join('\n')}
${selected ? `If a rating names no player, it is about player ${selected}.` : ''}
${ctx ? `Context: ${ctx}` : ''}

Rules:
- One rating per (player, attribute, score) said. A player with two attributes ("דני מסירה 4 ובעיטה 3") → two ratings.
- score is the number the coach SAID (digits or words: אחת/אחד=1, שתיים/שניים=2, שלוש/שלושה=3, ארבע/ארבעה=4, חמש/חמישה=5). Never invent or adjust a score. If no number was said for an attribute, skip it. A number above 5 → skip that rating.
- Transcripts from a noisy pitch contain errors: match names by sound (similar Hebrew spelling, nickname, shirt number "מספר 7"). If a name could be several roster players, leave player_ids empty and put them in candidate_ids. If it matches nobody, both empty and keep the heard name in name_heard.
- heard = the exact words of this rating from the transcript.
- If nothing usable, ratings: [].`;
const RATE_SCHEMA = {
  name: 'coach_ratings', strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['ratings'],
    properties: { ratings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['player_ids', 'candidate_ids', 'name_heard', 'attr', 'score', 'heard'],
      properties: {
        player_ids: { type: 'array', items: { type: 'string' } },
        candidate_ids: { type: 'array', items: { type: 'string' } },
        name_heard: { type: 'string' }, attr: { type: 'string' }, score: { type: 'integer' }, heard: { type: 'string' },
      } } } },
  },
};
// no AI available: a plain reading of "<name> <attribute> <number>" in Hebrew
const NUM_HE: Record<string, number> = { 'אחת': 1, 'אחד': 1, 'שתיים': 2, 'שתים': 2, 'שניים': 2, 'שנים': 2, 'שלוש': 3, 'שלושה': 3,
  'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5 };
const SYN: Record<string, string[]> = { passing: ['מסירה', 'מסירות', 'פס'], shooting: ['בעיטה', 'בעיטות', 'סיום', 'סיומת'],
  dribbling: ['כדרור', 'כדרורים'], first_touch: ['קבלה', 'כדור ראשון', 'נגיעה ראשונה'], heading: ['נגיחה', 'נגיחות'],
  speed: ['מהירות'], agility: ['זריזות'], strength: ['כוח'], stamina: ['סיבולת', 'כושר'], decisions: ['החלטות', 'קבלת החלטות'],
  teamwork: ['עבודת צוות'], determination: ['נחישות'], focus: ['ריכוז'], leadership: ['מנהיגות'], tackling: ['תיקול', 'תיקולים'],
  ball_control: ['שליטה', 'שליטה בכדור'], coordination: ['קואורדינציה', 'תיאום'], courage: ['אומץ'], listening: ['הקשבה'],
  long_pass: ['ארוכה', 'מסירה ארוכה', 'מסירות ארוכות'], crossing: ['הגבהה', 'הגבהות'] };
function plainRatings(text: string, players: Player[], attrs: Attr[]) {
  const out: any[] = [];
  const keys = new Set(attrs.map((a) => a.key));
  const words: [string, string][] = [];
  for (const a of attrs) { words.push([a.label, a.key]); for (const s of SYN[a.key] || []) words.push([s, a.key]); }
  words.sort((a, b) => b[0].length - a[0].length);
  for (const part of text.split(/[,،.;\n]| וגם | ו(?=[א-ת]+ [א-ת]+ \d)/)) {
    const s = part.trim(); if (!s) continue;
    const m = s.match(/(\d|אחת|אחד|שתיים|שתים|שניים|שנים|שלושה|שלוש|ארבעה|ארבע|חמישה|חמש)\s*$/);
    if (!m) continue;
    const score = /\d/.test(m[1]) ? +m[1] : NUM_HE[m[1]];
    if (!(score >= 1 && score <= 5)) continue;
    const w = words.find(([lbl]) => s.includes(lbl)); if (!w || !keys.has(w[1])) continue;
    const name = s.slice(0, s.indexOf(w[0])).replace(/^ו/, '').trim();
    const first = (n: string) => n.split(/\s+/)[0];
    const ids = name ? players.filter((p) => p.name === name || first(p.name) === first(name) || (p.nick && p.nick === name)).map((p) => p.id) : [];
    out.push({ player_ids: ids.length === 1 ? ids : [], candidate_ids: ids.length > 1 ? ids : [], name_heard: name, attr: w[1], score, heard: s });
  }
  return out;
}
async function parseRatings(text: string, players: Player[], attrs: Attr[], selected: string | null, ctx: string, lang = 'he') {
  const other = lang !== 'he' && LANG_NAME[lang] ? `\nThe coach speaks ${LANG_NAME[lang]}; number words are in that language.` : '';
  const messages = [{ role: 'system', content: RATE_SYSTEM(players, attrs, selected, ctx) + other }, { role: 'user', content: text }];
  const call = (rf: unknown, msgs = messages) => fetch(`${BASE}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${OAI}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TEXT_MODEL, temperature: 0, response_format: rf, messages: msgs }),
  });
  try {
    let r = await call({ type: 'json_schema', json_schema: RATE_SCHEMA });
    if (r.status === 400) {
      r = await call({ type: 'json_object' }, [{ role: 'system', content: messages[0].content + '\n\nReply with JSON only, exactly this schema: ' + JSON.stringify(RATE_SCHEMA.schema) }, messages[1]]);
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(String(r.status));
    return JSON.parse(j.choices[0].message.content).ratings || [];
  } catch {
    return plainRatings(text, players, attrs);
  }
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const LANG_NAME: Record<string, string> = { he: 'Hebrew', en: 'English', ru: 'Russian', ar: 'Arabic', es: 'Spanish',
  de: 'German', fr: 'French', it: 'Italian', pt: 'Portuguese', hi: 'Hindi' };
const STT_PROMPT: Record<string, string> = {
  he: 'מאמן כדורגל באימון ילדים. שמות: ', en: 'Youth football coach at training. Names: ', ru: 'Детский футбольный тренер на тренировке. Имена: ',
  ar: 'مدرب كرة قدم في تدريب أطفال. الأسماء: ', es: 'Entrenador de fútbol infantil en el entrenamiento. Nombres: ',
  de: 'Jugendfußballtrainer im Training. Namen: ', fr: 'Entraîneur de football des jeunes à l’entraînement. Prénoms : ',
  it: 'Allenatore di calcio giovanile in allenamento. Nomi: ', pt: 'Treinador de futebol de base no treino. Nomes: ',
  hi: 'युवा फ़ुटबॉल कोच ट्रेनिंग में। नाम: ' };

async function transcribe(bytes: Uint8Array, mime: string, players: Player[], lang = 'he', extra = '') {
  const ext = mime.includes('mp4') || mime.includes('aac') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime || 'audio/webm' }), `note.${ext}`);
  fd.append('model', STT_MODEL);
  fd.append('language', LANG_NAME[lang] ? lang : 'he');
  // the names help the recogniser spell the kids correctly
  fd.append('prompt', ((STT_PROMPT[lang] || STT_PROMPT.he) + players.map((p) => p.name + (p.nick ? ` (${p.nick})` : '')).join(', ') + extra).slice(0, 900));
  fd.append('temperature', '0');
  const r = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${OAI}` }, body: fd,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('תמלול נכשל: ' + (j?.error?.message || r.status));
  return String(j.text || '').trim();
}

async function parse(text: string, players: Player[], attrs: Attr[], selected: string | null, ctx: string, lang = 'he') {
  const other = lang !== 'he' && LANG_NAME[lang]
    ? `\n\nLANGUAGE: this note is spoken in ${LANG_NAME[lang]}, not Hebrew. Read it in ${LANG_NAME[lang]} (the Hebrew examples show the meaning), and write label and discipline_kind in ${LANG_NAME[lang]}.`
    : '';
  const messages = [
    { role: 'system', content: SYSTEM(players, attrs, selected, ctx) + other },
    { role: 'user', content: text },
  ];
  const call = (response_format: unknown, msgs = messages) => fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OAI}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.1, response_format, messages: msgs }),
  });
  let r = await call({ type: 'json_schema', json_schema: SCHEMA });
  // a model without strict schemas: ask for plain JSON in the same shape
  if (r.status === 400) {
    const msgs = [{ role: 'system', content: messages[0].content + '\n\nReply with JSON only, exactly this schema: ' + JSON.stringify(SCHEMA.schema) }, messages[1]];
    r = await call({ type: 'json_object' }, msgs);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ניתוח נכשל: ' + (j?.error?.message || r.status));
  try { return JSON.parse(j.choices[0].message.content).items || []; } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!OAI) return json({ error: 'חסר מפתח GROQ_API_KEY בהגדרות השרת' }, 500);

  // only a signed-in coach of a club
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(SB_URL, SRK, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'לא מחובר' }, 401);
  const { count } = await admin.from('coach_members').select('user_id', { count: 'exact', head: true }).eq('user_id', u.user.id).in('role', ['coach', 'assistant', 'manager']);
  if (!count) return json({ error: 'רק מאמנים' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'בקשה לא תקינה' }, 400); }
  const players: Player[] = (body.roster || []).slice(0, 80);
  const attrs: Attr[] = (body.attrs || []).slice(0, 60);
  const selected: string | null = body.selected || null;
  const ctx = String(body.context || '').slice(0, 300);
  const lang = LANG_NAME[body.lang] ? String(body.lang) : 'he';   // the app's language (2.7.0); older apps send nothing → Hebrew
  if (!body.audio && !body.text) return json({ error: 'אין הקלטה' }, 400);

  try {
    const bytes = body.audio ? b64ToBytes(body.audio) : null;
    if (bytes && bytes.length > 4_000_000) return json({ error: 'ההקלטה ארוכה מדי' }, 413);
    const rate = body.mode === 'rate';
    const extra = rate ? '. ' + attrs.map((a) => a.label).join(', ') + '. ' + (lang === 'he' ? 'למשל: יוסי מסירה 4, דני בעיטה 3.' : '') : '';
    const text = bytes ? await transcribe(bytes, String(body.mime || 'audio/webm'), players, lang, extra) : String(body.text).slice(0, 1000);
    if (!text) return json({ text: '', items: [], ratings: [] });
    if (rate) {
      const ids = new Set(players.map((p) => p.id)); const keys = new Set(attrs.map((a) => a.key));
      const raw = await parseRatings(text, players, attrs, selected, ctx, lang);
      const ratings = raw.map((r: any) => ({
        player_ids: (r.player_ids || []).filter((x: string) => ids.has(x)).slice(0, 1),
        candidate_ids: (r.candidate_ids || []).filter((x: string) => ids.has(x)),
        name_heard: String(r.name_heard || '').slice(0, 40),
        attr: keys.has(r.attr) ? r.attr : null,
        score: Math.round(+r.score),
        heard: String(r.heard || '').slice(0, 120),
      })).filter((r: any) => r.score >= 1 && r.score <= 5);
      return json({ text, ratings });
    }

    const raw = await parse(text, players, attrs, selected, ctx, lang);
    const ids = new Set(players.map((p) => p.id));
    const keys = new Set(attrs.map((a) => a.key));
    const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
    const items = raw.map((it: any) => ({
      who: it.who === 'team' ? 'team' : 'player',
      player_ids: (it.player_ids || []).filter((x: string) => ids.has(x)),
      candidate_ids: (it.candidate_ids || []).filter((x: string) => ids.has(x)),
      kind: ['rating', 'discipline', 'note'].includes(it.kind) ? it.kind : 'note',
      label: String(it.label || '').slice(0, 60),
      effects: (it.effects || []).filter((e: any) => keys.has(e.attr))
        .map((e: any) => ({ attr: e.attr, score: clamp(Math.round(e.score), 1, 5), weight: clamp(+e.weight || 1, 0.1, 1) })),
      foot: ['left', 'right'].includes(it.foot) ? it.foot : null,
      discipline_kind: String(it.discipline_kind || '').slice(0, 40),
      severity: clamp(Math.round(it.severity || 1), 1, 3),
      positive: !!it.positive,
    })).filter((it: any) => it.kind !== 'rating' || it.effects.length);
    return json({ text, items });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
