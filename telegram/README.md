# phr-telegram

Cloudflare Worker (plain JS ES module, no npm deps) that delivers PC Health Remote
alerts to Telegram. Endpoints: `POST /tg` (bot webhook), `POST /pair`, `POST /alert`, `GET /`.

Stores only chat id, language, source tag, device keys, PC names and counters
(KV binding `PHR`; the free daily alert counter lives in the `AlertCounter` Durable Object so alerts cost no KV writes). Secrets `BOT_TOKEN` and `WEBHOOK_SECRET` are set via
`wrangler secret put` and never committed. Free tier: 10 alerts per chat per UTC day.

Pro (Telegram Stars, `PRO_PRICE_STARS` in `worker.js`): `/pro` sends a 30-day subscription
invoice, Pro = no daily limit and up to 5 PCs (free: 1 PC). `/status` shows the plan.
Admin-only `/stats` and `/refund <charge_id>`: set the secret `ADMIN_CHAT_ID`
(`wrangler secret put ADMIN_CHAT_ID`). The webhook must allow `pre_checkout_query` updates.

Free users get the Pro offer (with the invoice link) when they hit the daily alert limit (at most once per
UTC day, reusing the counter's one-note flag, no extra KV writes) and when they try to pair a PC over the limit.

`/paysupport` (required by Telegram for Stars payments), `/terms` and `/support` answer in EN or RU.

## Bot commands (setMyCommands)

The deploy workflow does not register the bot menu yet. After a deploy, the admin sends `/setcommands`
to the bot once: it calls `setMyCommands` for the default (EN) and `ru` menus from `COMMANDS` in `worker.js`:

    /link /pcs /unlink /status /pro /terms /support /paysupport

(A step in `.github/workflows/telegram.yml` could do the same after `setWebhook`; not added here.)

## Test

    cd telegram && node --test
