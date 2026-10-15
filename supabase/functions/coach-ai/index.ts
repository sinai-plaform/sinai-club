// SINAI Club — coach-ai (3.0)
// The AI layer over the ratings that needs a language model. Today one action:
//   report_line — a personal sentence for the monthly report, written from the facts the app
//                 computed (strengths, what improved, focus, attendance, goals). The coach reads it,
//                 edits it and approves it; nothing reaches a parent without that approval.
// The facts are sent without surnames, phone numbers or ids: first name, team level and numbers only.
// Provider: GROQ_API_KEY (free tier, the same secret as the voice notes), OPENAI_API_KEY as an alternative.
// Optional: AI_TEXT_MODEL.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GROQ = Deno.env.get('GROQ_API_KEY') || '';
const KEY = GROQ || Deno.env.get('OPENAI_API_KEY') || '';
const BASE = GROQ ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
const MODEL = Deno.env.get('AI_TEXT_MODEL') || (GROQ ? 'openai/gpt-oss-120b' : 'gpt-4.1-mini');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const LANG: Record<string, string> = { he: 'Hebrew', en: 'English', ru: 'Russian', ar: 'Arabic', es: 'Spanish', de: 'German',
  fr: 'French', it: 'Italian', pt: 'Portuguese', hi: 'Hindi' };

const SYSTEM = (lang: string) => `You are a warm, professional youth football coach writing the personal sentence of a monthly progress report that goes to a child's parents.
Write in ${LANG[lang] || 'Hebrew'}. 1–2 sentences, at most 40 words. Specific to the facts given: name one real strength or improvement and one thing the child is working on next. Encouraging and honest, never exaggerated; praise effort and improvement, not talent. No numbers or scores, no comparison with other children, no emojis, no greeting or signature.
${lang === 'he' ? 'Hebrew has gendered verbs and the child\'s gender is unknown: write so that it reads naturally for a boy or a girl — prefer phrasing around the child\'s name and nouns ("ההתקדמות של נועם במסירות…", "הדבר הבא לעבוד עליו: …") over gendered verb forms.' : ''}
Reply with the sentence only.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!KEY) return json({ error: 'חסר מפתח GROQ_API_KEY בהגדרות השרת' }, 500);
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const admin = createClient(SB_URL, SRK, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'לא מחובר' }, 401);
  const { count } = await admin.from('coach_members').select('user_id', { count: 'exact', head: true })
    .eq('user_id', u.user.id).in('role', ['coach', 'assistant', 'manager']);
  if (!count) return json({ error: 'רק מאמנים' }, 403);

  let body: any; try { body = await req.json(); } catch { return json({ error: 'בקשה לא תקינה' }, 400); }
  if (body.action !== 'report_line') return json({ error: 'פעולה לא מוכרת' }, 400);
  const f = body.facts || {};
  const lang = LANG[body.lang] ? String(body.lang) : 'he';
  const facts = {
    first_name: String(f.first_name || '').slice(0, 30),
    age_group: String(f.age_group || '').slice(0, 20),
    month: String(f.month || '').slice(0, 20),
    attendance: String(f.attendance || '').slice(0, 30),
    strengths: (f.strengths || []).slice(0, 3).map(String),
    improved: (f.improved || []).slice(0, 3).map(String),
    working_on: (f.working_on || []).slice(0, 3).map(String),
    goals: (f.goals || []).slice(0, 3).map(String),
    achievements: (f.achievements || []).slice(0, 4).map(String),
    coach_notes: String(f.coach_notes || '').slice(0, 200),
  };
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.6, max_tokens: 900, ...(GROQ && /gpt-oss/.test(MODEL) ? { reasoning_effort: 'low' } : {}),
      messages: [{ role: 'system', content: SYSTEM(lang) }, { role: 'user', content: JSON.stringify(facts) }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) {
    const m = String(j?.error?.message || '').match(/try again in ([\d.]+)s/i);
    return json({ wait: m ? Math.ceil(+m[1]) : 10 }, 429);
  }
  if (!r.ok) return json({ error: 'AI: ' + (j?.error?.message || r.status) }, 502);
  const line = String(j.choices?.[0]?.message?.content || '').replace(/^["'“”״]+|["'“”״]+$/g, '').trim().slice(0, 400);
  return json({ line });
});
