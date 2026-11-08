import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, AlertCounter, FREE_DAILY_LIMIT, PRO_PRICE_STARS } from "./worker.js";

function mkKv() {
  const m = new Map();
  const kv = {
    m,
    writes: 0,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => {
      kv.writes++;
      m.set(k, v);
    },
    delete: async (k) => void m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
  return kv;
}

// Fake Durable Object namespace: one AlertCounter per name, storage in a Map, alarms recorded.
function mkCounterNs() {
  const objs = new Map();
  const ns = {
    objs,
    idFromName: (name) => name,
    get: (id) => {
      if (!objs.has(id)) {
        const data = new Map();
        const storage = {
          data,
          alarm: null,
          get: async (k) => data.get(k),
          put: async (k, v) => void data.set(k, structuredClone(v)),
          setAlarm: async (t) => void (storage.alarm = t),
          deleteAll: async () => void data.clear(),
        };
        objs.set(id, new AlertCounter({ storage }));
      }
      const obj = objs.get(id);
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
    },
  };
  return ns;
}

function setup(t0 = Date.UTC(2026, 0, 1, 12), { counter = false } = {}) {
  const sent = [];
  const calls = [];
  const clock = { t: t0 };
  const env = { PHR: mkKv(), BOT_TOKEN: "tok", WEBHOOK_SECRET: "sec", ADMIN_CHAT_ID: "999" };
  if (counter) env.ALERT_COUNTER = mkCounterNs();
  const opts = {
    now: () => clock.t,
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      calls.push({ method: url.split("/").pop(), body: sent.at(-1) });
      return new Response('{"ok":true,"result":"https://t.me/$inv"}', { status: 200 });
    },
  };
  const call = (path, body, headers = {}, method = "POST") =>
    handle(new Request("https://x" + path, { method, headers, body: body && JSON.stringify(body) }), env, opts);
  const say = (text, from = {}, chat = 1) =>
    call("/tg", { message: { chat: { id: chat }, from, text } }, { "X-Telegram-Bot-Api-Secret-Token": "sec" });
  const hook = { "X-Telegram-Bot-Api-Secret-Token": "sec" };
  const upd = (u) => call("/tg", u, hook);
  const pay = (id, chat = 1, extra = {}) =>
    upd({
      message: {
        chat: { id: chat },
        successful_payment: {
          currency: "XTR",
          total_amount: PRO_PRICE_STARS,
          invoice_payload: "pro30:" + chat,
          telegram_payment_charge_id: id,
          subscription_expiration_date: Math.floor(clock.t / 1000) + 2592000,
          ...extra,
        },
      },
    });
  return { env, sent, calls, clock, call, say, upd, pay };
}

const msgs = (s) => s.calls.filter((c) => c.method === "sendMessage");

async function pair(s, name = "GAMING-PC", chat = 1) {
  await s.say("/link", {}, chat);
  const code = /: ([A-Z0-9]{6})/.exec(s.sent.at(-1).text)[1];
  const r = await s.call("/pair", { code, pc_name: name });
  return { code, r, body: await r.clone().json() };
}

test("GET / is up", async () => {
  const s = setup();
  const r = await s.call("/", null, {}, "GET");
  assert.equal(await r.text(), "phr-telegram up");
});

test("webhook secret check", async () => {
  const s = setup();
  const upd = { message: { chat: { id: 1 }, text: "/start" } };
  const bad = await s.call("/tg", upd, { "X-Telegram-Bot-Api-Secret-Token": "no" });
  assert.equal(bad.status, 403);
  const none = await s.call("/tg", upd);
  assert.equal(none.status, 403);
  assert.equal(s.sent.length, 0);
});

test("/start greets by language and stores source tag", async () => {
  const s = setup();
  await s.say("/start src_reddit", { language_code: "ru" });
  assert.match(s.sent[0].text, /Привет/);
  assert.equal(JSON.parse(s.env.PHR.m.get("user:1")).src, "reddit");
  const s2 = setup();
  await s2.say("/start", { language_code: "en" });
  assert.match(s2.sent[0].text, /Hi!/);
  assert.equal(JSON.parse(s2.env.PHR.m.get("user:1")).src, null);
});

test("pairing: code works once and returns device key", async () => {
  const s = setup();
  const { code, r, body } = await pair(s);
  assert.equal(r.status, 200);
  assert.match(body.device_key, /^[0-9a-f]{64}$/);
  const again = await s.call("/pair", { code, pc_name: "X" });
  assert.equal(again.status, 400);
  await s.say("/pcs");
  assert.match(s.sent.at(-1).text, /GAMING-PC/);
});

test("pairing: code expires after 10 min", async () => {
  const s = setup();
  await s.say("/link");
  const code = /: ([A-Z0-9]{6})/.exec(s.sent.at(-1).text)[1];
  s.clock.t += 10 * 60 * 1000 + 1;
  const r = await s.call("/pair", { code, pc_name: "PC" });
  assert.equal(r.status, 400);
});

test("alert delivery", async () => {
  const s = setup();
  const { body } = await pair(s);
  const r = await s.call(
    "/alert",
    { rule: "cpu_temp", value: 92, threshold: 85, unit: "C", pc_name: "GAMING-PC" },
    { "X-Device-Key": body.device_key },
  );
  assert.equal(r.status, 200);
  assert.equal(s.sent.at(-1).text, "🔥 GAMING-PC: CPU temp 92°C (limit 85°C)");
  assert.equal(s.sent.at(-1).chat_id, 1);
});

test("alert with bad or missing key is 401", async () => {
  const s = setup();
  const body = { rule: "cpu_load", value: 1 };
  assert.equal((await s.call("/alert", body)).status, 401);
  assert.equal((await s.call("/alert", body, { "X-Device-Key": "nope" })).status, 401);
  assert.equal(s.sent.length, 0);
});

test("daily limit, one note, resets next UTC day", async () => {
  const s = setup();
  const { body } = await pair(s);
  const h = { "X-Device-Key": body.device_key };
  const a = { rule: "cpu_temp", value: 90, threshold: 85, unit: "C" };
  const before = msgs(s).length;
  for (let i = 0; i < FREE_DAILY_LIMIT; i++) assert.equal((await s.call("/alert", a, h)).status, 200);
  assert.equal(msgs(s).length - before, FREE_DAILY_LIMIT);
  assert.equal((await s.call("/alert", a, h)).status, 429);
  assert.equal((await s.call("/alert", a, h)).status, 429);
  assert.equal(msgs(s).length - before, FREE_DAILY_LIMIT + 1);
  assert.match(msgs(s).at(-1).body.text, /limit/i);
  s.clock.t += 24 * 3600 * 1000;
  assert.equal((await s.call("/alert", a, h)).status, 200);
});

test("/unlink revokes the device key", async () => {
  const s = setup();
  const { body } = await pair(s);
  await s.say("/unlink GAMING-PC");
  const r = await s.call("/alert", { rule: "cpu_load", value: 1 }, { "X-Device-Key": body.device_key });
  assert.equal(r.status, 401);
  await s.say("/pcs");
  assert.match(s.sent.at(-1).text, /No linked/);
});

test("alert rejects unknown rule, non-numeric value and keeps the paired PC name", async () => {
  const s = setup();
  const { body } = await pair(s);
  const h = { "X-Device-Key": body.device_key };
  const before = s.sent.length;
  assert.equal((await s.call("/alert", { rule: "Click http://evil", value: 1 }, h)).status, 400);
  assert.equal((await s.call("/alert", { rule: "cpu_temp", value: "99 visit x.y" }, h)).status, 400);
  assert.equal((await s.call("/alert", { rule: "cpu_temp", value: 9, threshold: "x" }, h)).status, 400);
  assert.equal((await s.call("/alert", { rule: "__proto__", value: 1 }, h)).status, 400);
  assert.equal(s.sent.length, before);
  const r = await s.call("/alert", { rule: "ram_load", value: 97, pc_name: "Spoofed text" }, h);
  assert.equal(r.status, 200);
  assert.equal(s.sent.at(-1).text, "🔥 GAMING-PC: RAM 97%");
});

test("/pro creates a Stars subscription invoice link", async () => {
  const s = setup();
  await s.say("/pro", {}, 5);
  const c = s.calls.find((x) => x.method === "createInvoiceLink");
  assert.equal(c.body.currency, "XTR");
  assert.equal(c.body.subscription_period, 2592000);
  assert.deepEqual(c.body.prices, [{ label: "Pro 30d", amount: PRO_PRICE_STARS }]);
  assert.equal(c.body.payload, "pro30:5");
  assert.match(s.sent.at(-1).text, /https:\/\/t\.me\/\$inv/);
});

test("pre_checkout_query: ok for valid payload, rejected otherwise", async () => {
  const s = setup();
  const q = (over) => ({
    pre_checkout_query: { id: "q1", from: { id: 7 }, currency: "XTR", total_amount: PRO_PRICE_STARS, invoice_payload: "pro30:7", ...over },
  });
  await s.upd(q({}));
  assert.equal(s.calls.at(-1).method, "answerPreCheckoutQuery");
  assert.equal(s.calls.at(-1).body.ok, true);
  await s.upd(q({ invoice_payload: "pro30:8" }));
  assert.equal(s.calls.at(-1).body.ok, false);
  await s.upd(q({ total_amount: 1 }));
  assert.equal(s.calls.at(-1).body.ok, false);
});

test("successful_payment counted once; duplicate ignored; records source", async () => {
  const s = setup();
  await s.say("/start src_reddit", {}, 1);
  await s.pay("ch1");
  const n = s.env.PHR.m.size;
  const sentN = s.sent.length;
  await s.pay("ch1");
  assert.equal(s.env.PHR.m.size, n);
  assert.equal(s.sent.length, sentN);
  const u = JSON.parse(s.env.PHR.m.get("user:1"));
  assert.equal(u.pro.until, s.clock.t + 2592000 * 1000);
  assert.equal(JSON.parse(s.env.PHR.m.get("pay:ch1")).src, "reddit");
  await s.pay("bad", 1, { invoice_payload: "pro30:2" });
  assert.equal(s.env.PHR.m.has("pay:bad"), false);
});

test("Pro expires; free vs Pro alert limits (fresh non-admin user)", async () => {
  const s = setup();
  const { body } = await pair(s);
  await s.pay("ch1");
  const h = { "X-Device-Key": body.device_key };
  const a = { rule: "cpu_temp", value: 90 };
  for (let i = 0; i < FREE_DAILY_LIMIT + 5; i++) assert.equal((await s.call("/alert", a, h)).status, 200);
  await s.say("/status");
  assert.match(s.sent.at(-1).text, /Plan: Pro/);
  s.clock.t += 31 * 24 * 3600 * 1000;
  await s.say("/status");
  assert.match(s.sent.at(-1).text, /Plan: Free/);
  for (let i = 0; i < FREE_DAILY_LIMIT; i++) assert.equal((await s.call("/alert", a, h)).status, 200);
  assert.equal((await s.call("/alert", a, h)).status, 429);
});

test("PC limit: free 1, Pro 5", async () => {
  const s = setup();
  assert.equal((await pair(s, "A")).r.status, 200);
  assert.equal((await pair(s, "B")).r.status, 403);
  assert.equal((await pair(s, "A")).r.status, 200); // re-pair same name is fine
  await s.pay("ch1");
  for (const n of ["B", "C", "D", "E"]) assert.equal((await pair(s, n)).r.status, 200);
  assert.equal((await pair(s, "F")).r.status, 403);
});

test("/stats and /refund are admin only", async () => {
  const s = setup();
  await s.say("/start src_x", {}, 1);
  await s.pay("ch1");
  const before = s.sent.length;
  await s.say("/stats", {}, 1);
  await s.say("/refund ch1", {}, 1);
  assert.equal(s.sent.length, before);
  assert.equal(s.calls.some((c) => c.method === "refundStarPayment"), false);
  await s.say("/stats", {}, 999);
  assert.match(s.sent.at(-1).text, /Users: 1[\s\S]*Pro: 1[\s\S]*Stars: 99[\s\S]*x: users 1, pro 1, stars 99/);
  await s.say("/refund ch1", {}, 999);
  const r = s.calls.find((c) => c.method === "refundStarPayment");
  assert.deepEqual(r.body, { user_id: 1, telegram_payment_charge_id: "ch1" });
  await s.say("/status", {}, 1);
  assert.match(s.sent.at(-1).text, /Plan: Free/);
  await s.say("/stats", {}, 999);
  assert.match(s.sent.at(-1).text, /Stars: 0/);
});

test("/pair is rate limited per IP when PAIR_LIMIT is bound", async () => {
  const s = setup();
  const seen = [];
  s.env.PAIR_LIMIT = { limit: async ({ key }) => (seen.push(key), { success: seen.length <= 2 }) };
  const h = { "CF-Connecting-IP": "203.0.113.7" };
  assert.equal((await s.call("/pair", { code: "AAAAAA", pc_name: "x" }, h)).status, 400);
  assert.equal((await s.call("/pair", { code: "BBBBBB", pc_name: "x" }, h)).status, 400);
  assert.equal((await s.call("/pair", { code: "CCCCCC", pc_name: "x" }, h)).status, 429);
  assert.deepEqual(seen, ["203.0.113.7", "203.0.113.7", "203.0.113.7"]);
});

// KV write budget (issue #27): free tier = 1000 KV writes/day.
async function alertWrites(counter, users, perUser) {
  const s = setup(undefined, { counter });
  const keys = [];
  for (let u = 0; u < users; u++) keys.push((await pair(s, "PC" + u, 100 + u)).body.device_key);
  const a = { rule: "cpu_temp", value: 90 };
  const before = s.env.PHR.writes;
  const codes = [];
  for (const k of keys) for (let i = 0; i < perUser; i++) codes.push((await s.call("/alert", a, { "X-Device-Key": k })).status);
  return { writes: s.env.PHR.writes - before, codes, s };
}

test("KV writes per 100 alerts: before (KV counter) vs after (Durable Object counter)", async () => {
  const kv10x10 = await alertWrites(false, 10, 10);
  const do10x10 = await alertWrites(true, 10, 10);
  const kv1x100 = await alertWrites(false, 1, 100);
  const do1x100 = await alertWrites(true, 1, 100);
  console.log("KV writes per 100 alerts, 10 users x 10:", kv10x10.writes, "->", do10x10.writes);
  console.log("KV writes per 100 alerts, 1 user x 100:", kv1x100.writes, "->", do1x100.writes);
  assert.equal(kv10x10.writes, 100);
  assert.equal(do10x10.writes, 0);
  assert.equal(kv1x100.writes, 11);
  assert.equal(do1x100.writes, 0);
  assert.deepEqual(do10x10.codes, kv10x10.codes);
  assert.deepEqual(do1x100.codes, kv1x100.codes);
});

test("Durable Object counter: limit enforced, one note, resets next UTC day, /status shows usage", async () => {
  const s = setup(undefined, { counter: true });
  const { body } = await pair(s);
  const h = { "X-Device-Key": body.device_key };
  const a = { rule: "cpu_temp", value: 90 };
  const before = msgs(s).length;
  for (let i = 0; i < FREE_DAILY_LIMIT; i++) assert.equal((await s.call("/alert", a, h)).status, 200);
  assert.equal((await s.call("/alert", a, h)).status, 429);
  assert.equal((await s.call("/alert", a, h)).status, 429);
  assert.equal(msgs(s).length - before, FREE_DAILY_LIMIT + 1); // 10 alerts + one limit note
  await s.say("/status");
  assert.match(s.sent.at(-1).text, new RegExp(String(FREE_DAILY_LIMIT)));
  s.clock.t += 24 * 3600 * 1000;
  assert.equal((await s.call("/alert", a, h)).status, 200);
});

test("Durable Object counter forgets the day via its alarm", async () => {
  const s = setup(undefined, { counter: true });
  const { body } = await pair(s);
  await s.call("/alert", { rule: "cpu_temp", value: 90 }, { "X-Device-Key": body.device_key });
  const [obj] = s.env.ALERT_COUNTER.objs.values();
  assert.ok(obj.storage.alarm > Date.now());
  await obj.alarm();
  assert.equal(obj.storage.data.size, 0);
});

// Issue #31: Stars payment commands and Pro upsell.
test("/paysupport, /terms, /support answer in EN and RU", async () => {
  const s = setup();
  for (const [lang, re] of [
    ["en", { paysupport: /Payment help[\s\S]*admin/, terms: /Terms[\s\S]*30 days[\s\S]*Refund[\s\S]*warranty/, support: /Questions/ }],
    ["ru", { paysupport: /Помощь с оплатой[\s\S]*администратор/, terms: /Условия[\s\S]*30 дней[\s\S]*Возврат[\s\S]*без гарантий/, support: /Вопросы/ }],
  ]) {
    for (const cmd of ["paysupport", "terms", "support"]) {
      await s.say("/" + cmd, { language_code: lang });
      assert.match(s.sent.at(-1).text, re[cmd], lang + " /" + cmd);
    }
  }
  await s.say("/support@phr_bot");
  assert.match(s.sent.at(-1).text, /https:\/\/github\.com\/ataman-lab\/pc-health-remote\/issues/);
  await s.say("/paysupport");
  assert.match(s.sent.at(-1).text, /github\.com\/ataman-lab\/pc-health-remote\/issues/);
  await s.say("/terms");
  assert.match(s.sent.at(-1).text, new RegExp(PRO_PRICE_STARS + " Stars"));
  assert.equal(s.calls.some((c) => c.method !== "sendMessage"), false); // no invoices, no refunds
});

test("/setcommands is admin only and registers EN + RU menus", async () => {
  const s = setup();
  await s.say("/setcommands", {}, 1);
  assert.equal(s.calls.some((c) => c.method === "setMyCommands"), false);
  await s.say("/setcommands", {}, 999);
  const sc = s.calls.filter((c) => c.method === "setMyCommands");
  assert.equal(sc.length, 2);
  assert.equal(sc[0].body.language_code, undefined);
  assert.equal(sc[1].body.language_code, "ru");
  for (const c of sc) {
    const names = c.body.commands.map((x) => x.command);
    for (const n of ["paysupport", "terms", "support", "pro", "status"]) assert.ok(names.includes(n), n);
  }
  assert.equal(s.sent.at(-1).text, "Commands set");
});

for (const counter of [false, true]) {
  test("upsell at the daily alert limit: once per day, with the Pro invoice (" + (counter ? "Durable Object" : "KV") + " counter)", async () => {
    const s = setup(undefined, { counter });
    const { body } = await pair(s);
    const h = { "X-Device-Key": body.device_key };
    const a = { rule: "cpu_temp", value: 90 };
    for (let i = 0; i < FREE_DAILY_LIMIT; i++) await s.call("/alert", a, h);
    const inv0 = s.calls.filter((c) => c.method === "createInvoiceLink").length;
    const kvBefore = s.env.PHR.writes;
    for (let i = 0; i < 5; i++) assert.equal((await s.call("/alert", a, h)).status, 429);
    const inv = s.calls.filter((c) => c.method === "createInvoiceLink");
    assert.equal(inv.length - inv0, 1); // one upsell for 5 dropped alerts
    assert.equal(inv.at(-1).body.payload, "pro30:1");
    assert.deepEqual(inv.at(-1).body.prices, [{ label: "Pro 30d", amount: PRO_PRICE_STARS }]);
    const note = msgs(s).at(-1).body.text;
    assert.match(note, /limit/i);
    assert.match(note, /https:\/\/t\.me\/\$inv/);
    assert.equal(s.env.PHR.writes - kvBefore, counter ? 0 : 1); // same write budget as the plain note
    s.clock.t += 24 * 3600 * 1000; // next day: one more upsell after the limit
    for (let i = 0; i < FREE_DAILY_LIMIT + 3; i++) await s.call("/alert", a, h);
    assert.equal(s.calls.filter((c) => c.method === "createInvoiceLink").length - inv0, 2);
  });
}

test("upsell when a free user pairs a second PC; none for Pro or re-pair", async () => {
  const s = setup();
  await pair(s, "A", 1);
  await s.say("/link", { language_code: "ru" }, 1);
  const code = /: ([A-Z0-9]{6})/.exec(s.sent.at(-1).text)[1];
  const r = await s.call("/pair", { code, pc_name: "B" });
  const body = await r.json();
  assert.equal(r.status, 403);
  assert.deepEqual(body, { error: "pc limit reached" }); // PC gets the same answer as before
  const inv = s.calls.filter((c) => c.method === "createInvoiceLink");
  assert.equal(inv.length, 1);
  assert.equal(inv[0].body.payload, "pro30:1");
  const note = msgs(s).at(-1).body;
  assert.equal(note.chat_id, 1);
  assert.match(note.text, /бесплатном тарифе[\s\S]*https:\/\/t\.me\/\$inv/);
  assert.equal((await pair(s, "A", 1)).r.status, 200); // re-pair same name: no upsell
  assert.equal(s.calls.filter((c) => c.method === "createInvoiceLink").length, 1);
  await s.pay("ch1");
  for (const n of ["B", "C", "D", "E"]) await pair(s, n);
  assert.equal((await pair(s, "F")).r.status, 403); // Pro at 5 PCs: no upsell
  assert.equal(s.calls.filter((c) => c.method === "createInvoiceLink").length, 1);
});
