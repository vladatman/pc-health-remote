// Copy of overclock-lab infra/hq-desk/client.js (support department, HQ inbox). Keep in sync with that file.
// HQ client for the bots (Theorie 44, KNM, Zrozumilo, PC Health, ...). Zero dependencies, Workers + Node.
// The bot binds the hq-desk Worker as service HQ and has the secret HQ_TOKEN. Without them support still answers
// with a polite fallback, so a bot never breaks because HQ is down.

export const SUPPORT_WINDOW_MS = 15 * 60 * 1000; // after /support, the next text message goes to support
export const MAX_TEXT = 2000;

export const SUPPORT_COPY = {
  en: {
    ask: '💬 Support: write your question, idea or problem in one message. An AI answers right away; if it needs a human, the team replies here within 24 hours. Your message is stored up to 30 days to handle it.',
    empty: 'Send /support and then your message as text.',
    down: 'Thanks, message received. The team will reply here within 24 hours.',
    button: '💬 Support',
  },
  ru: {
    ask: '💬 Поддержка: напишите вопрос, идею или проблему одним сообщением. ИИ ответит сразу; если нужен человек, команда ответит здесь в течение 24 часов. Сообщение хранится до 30 дней для обработки.',
    empty: 'Отправьте /support, а затем ваше сообщение текстом.',
    down: 'Спасибо, сообщение получено. Команда ответит здесь в течение 24 часов.',
    button: '💬 Поддержка',
  },
  uk: {
    ask: '💬 Підтримка: напишіть запитання, ідею або проблему одним повідомленням. ШІ відповість одразу; якщо потрібна людина, команда відповість тут протягом 24 годин. Повідомлення зберігається до 30 днів для обробки.',
    empty: 'Надішліть /support, а потім ваше повідомлення текстом.',
    down: 'Дякуємо, повідомлення отримано. Команда відповість тут протягом 24 годин.',
    button: '💬 Підтримка',
  },
};
export const supportCopy = lang => SUPPORT_COPY[lang] || SUPPORT_COPY.en;

// Shared person reference (agreed with monitoring): first 12 hex of HMAC-SHA256(LAB_REF_KEY, "tg:<id>").
export async function labRef(env, tgId) {
  if (!env.LAB_REF_KEY) return 'noref';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LAB_REF_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`tg:${tgId}`)));
  return [...sig.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function post(env, path, body) {
  if (!env.HQ?.fetch || !env.HQ_TOKEN) return null;
  const r = await env.HQ.fetch(`https://hq${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-hq-token': env.HQ_TOKEN }, body: JSON.stringify(body),
  });
  return r.ok ? r.json() : null;
}

// Event v1 to the one HQ inbox: {v:1, dept, src, kind, severity, at, ref, summary, data}. Best effort.
export async function hqEvent(env, event) {
  try { return await post(env, '/event', { v: 1, at: new Date().toISOString(), ...event }); } catch { return null; }
}

// Sends one support message to HQ and returns the text to show the user (AI answer or a "we got it" note).
// key must be unique per Telegram update (e.g. `${update_id}`) so a webhook retry does not open a second ticket.
export async function supportTicket(env, { src, lang, uid, text, key }) {
  const t = supportCopy(lang);
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) return t.empty;
  try {
    const r = await post(env, '/ticket', { src, lang, uid, text: clean, key: `${src}:${key}` });
    if (r?.reply) return r.reply;
  } catch {}
  return t.down;
}

// The bot's side of HQ replies: hq-desk POSTs {uid, text} to <bot>/hq-reply when Vlad answers a ticket.
// Returns {uid, text} for the bot to send, or a Response to return (unauthorized / bad request).
export async function readHqReply(request, env) {
  if (!env.HQ_TOKEN || request.headers.get('x-hq-token') !== env.HQ_TOKEN) return new Response('Forbidden', { status: 403 });
  let b;
  try { b = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
  const uid = Number(b?.uid);
  if (!Number.isSafeInteger(uid) || uid <= 0 || typeof b.text !== 'string' || !b.text.trim()) return new Response('Bad request', { status: 400 });
  return { uid, text: b.text.slice(0, 3500) };
}
