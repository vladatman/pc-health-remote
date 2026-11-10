import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./worker.js";

// Support through overclock-lab hq-desk (service binding HQ). Synthetic fixtures only.
function setup({ hq = true } = {}) {
  const m = new Map();
  const sent = [];
  const tickets = [];
  const env = {
    PHR: { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) },
    BOT_TOKEN: "tok", WEBHOOK_SECRET: "sec", ADMIN_CHAT_ID: "999", HQ_TOKEN: "hq",
    ...(hq ? { HQ: { fetch: async (_u, init) => { const b = JSON.parse(init.body); tickets.push(b); return Response.json({ reply: "AI: " + b.text }); } } } : {}),
  };
  let t = Date.UTC(2026, 0, 1, 12);
  const opts = { now: () => t, fetch: async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"ok":true}'); } };
  let id = 0;
  const say = (text) => handle(new Request("https://x/tg", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "sec" }, body: JSON.stringify({ update_id: ++id, message: { message_id: id, chat: { id: 5 }, from: { language_code: "ru" }, text } }) }), env, opts);
  const post = (body, token) => handle(new Request("https://x/hq-reply", { method: "POST", headers: token ? { "x-hq-token": token } : {}, body: JSON.stringify(body) }), env, opts);
  return { sent, tickets, say, post, advance: (ms) => { t += ms; } };
}

test("/support <text> goes to HQ as src pchealth and the user gets the AI reply", async () => {
  const s = setup();
  await s.say("/support Не приходят уведомления о температуре");
  assert.equal(s.tickets.length, 1);
  assert.equal(s.tickets[0].src, "pchealth");
  assert.equal(s.tickets[0].lang, "ru");
  assert.equal(s.tickets[0].uid, 5);
  assert.equal(s.sent.at(-1).text, "AI: Не приходят уведомления о температуре");
});

test("the 💬 Поддержка button opens a window, the next text is the ticket, then it closes", async () => {
  const s = setup();
  await s.say("💬 Поддержка");
  assert.match(s.sent.at(-1).text, /Поддержка: напишите/);
  await s.say("Хочу график за неделю");
  assert.equal(s.tickets[0].text, "Хочу график за неделю");
  await s.say("ещё");
  assert.equal(s.tickets.length, 1);
});

test("window expires after 15 minutes", async () => {
  const s = setup();
  await s.say("/support");
  s.advance(16 * 60 * 1000);
  await s.say("поздно");
  assert.equal(s.tickets.length, 0);
});

test("without HQ, /support keeps the issues link", async () => {
  const s = setup({ hq: false });
  await s.say("/support");
  assert.match(s.sent.at(-1).text, /issues/);
  assert.equal(s.tickets.length, 0);
});

test("/hq-reply needs the HQ token", async () => {
  const s = setup();
  assert.equal((await s.post({ uid: 5, text: "x" })).status, 403);
  assert.equal((await s.post({ uid: 5, text: "Починили!" }, "hq")).status, 200);
  assert.deepEqual(s.sent.at(-1), { chat_id: 5, text: "💬 Починили!" });
});

test("/support then /paysupport: the payment text goes to the admin, not to HQ", async () => {
  const s = setup();
  await s.say("/support");
  await s.say("/paysupport");
  await s.say("Списали дважды");
  assert.equal(s.tickets.length, 0);
  assert.ok(s.sent.some((m) => m.chat_id === "999" && /Списали дважды/.test(m.text)));
});
