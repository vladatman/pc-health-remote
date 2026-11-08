# Launch kit: Telegram alerts

> **Vlad publishes; Claude never posts publicly.** Everything below is a draft. Nothing here has been posted.

Issue: #14 (G6.5 Launch kit). Facts below come from `README.md`, `docs/TELEGRAM.md` and `telegram/worker.js` at the
time of writing; re-check them if the worker changes before launch.

## What we are launching (facts only)

- Bot **@PCHealthRemoteBot** sends PC alerts to Telegram. The PC backend (`pc-health-remote.exe`, Windows; Linux
  best-effort) runs the same 9 alert rules as the Flipper app. **A Flipper is not required for Telegram alerts.**
- Setup: `/link` in the bot -> 6-character code (valid 10 min) -> `pc-health-remote.exe --link-telegram <CODE>` ->
  restart the backend.
- Alert text looks like: `🔥 GAMING-PC: CPU temp 92°C (limit 90°C)`. The same alert repeats at most every 5 minutes.
- Bot commands: `/link`, `/pcs`, `/unlink <name>`, `/status`, `/pro`.
- Plans (`FREE_*` / `PRO_*` constants in `telegram/worker.js`):

| | Free | Pro |
|---|---|---|
| PCs | 1 | 5 |
| Alerts per day (UTC) | 10 | unlimited |
| Price | 0 | 99 Telegram Stars / 30 days, auto-renew, cancel in Telegram |

- Privacy: the bot stores chat id, language, source tag, device keys, PC names, daily counters, payment records. No
  temperature history, no message text in logs.
- Open source, MIT. Current release: v1.1.0 (Telegram alerts).

## 1. Deep links per source

| Source | Link |
|---|---|
| GitHub release | https://t.me/PCHealthRemoteBot?start=src_github_release |
| Flipper forum | https://t.me/PCHealthRemoteBot?start=src_flipper_forum |
| r/flipperzero | https://t.me/PCHealthRemoteBot?start=src_reddit_flipper |
| r/pcmasterrace | https://t.me/PCHealthRemoteBot?start=src_reddit_pcmasterrace |
| TikTok | https://t.me/PCHealthRemoteBot?start=src_tiktok |
| Telegram Ads | https://t.me/PCHealthRemoteBot?start=src_telegram_ads |
| Friends | https://t.me/PCHealthRemoteBot?start=src_friends |

**Is the payload recorded? Yes.** In `handleMessage`, `/start` matches `^src_([A-Za-z0-9_-]{1,32})$` and saves the tag
as `user.src` in KV (`user:<chat>`). All 7 tags above fit the pattern (longest, `reddit_pcmasterrace`, is 19 chars).
On payment, `handlePayment` copies `user.src` into the `pay:<charge_id>` record, so Stars are attributed per source.

**Gap notes (no code changed):**
- Last touch wins: a later `/start src_<other>` overwrites the tag. A plain `/start` (no payload) keeps the old tag.
- A user who never presses Start through a link (types `/link` directly) is counted under `-` (no source).
- The payload arrives only when the user taps **Start** from the link; a link copied without `?start=` lands
  under `-`.

## 2. Screen-video scripts (20-30 s, phone filming the PC + Telegram on a second phone or the same phone)

Honesty rule for all three: if the spike is produced with `--simulate` (synthetic values), put a small on-screen
caption "simulated values" for those seconds. A real spike (game, stress test, or a temporarily lowered limit) needs no
caption. Never fake the Telegram message itself.

### Video A: "Your PC texts you when it overheats" (25 s)

| Time | Shot | On-screen text / VO |
|---|---|---|
| 0-3 s | Close-up of the phone lying next to the keyboard, screen dark | "My PC texts me when it overheats" |
| 3-8 s | Pan to monitor: a game or stress test running, tray icon of PC Health Remote visible | "Game running, I walk away" |
| 8-12 s | Camera follows you to the kitchen / sofa | - |
| 12-17 s | Phone lights up: Telegram notification `🔥 GAMING-PC: CPU temp 92°C (limit 90°C)` (real value) | Freeze 1 s on the message |
| 17-22 s | Open the chat, show `/status`: plan Free, PCs 1, alerts today N | "Free: 1 PC, 10 alerts a day" |
| 22-25 s | End card: bot name + "open source, link in bio" | "@PCHealthRemoteBot" |

### Video B: "Setup in 20 seconds" (22 s)

| Time | Shot | On-screen text / VO |
|---|---|---|
| 0-3 s | Phone: open @PCHealthRemoteBot, tap Start | "Telegram alerts for your PC" |
| 3-7 s | Send `/link`, the 6-character code appears | "1. /link" |
| 7-13 s | Film the PC screen: PowerShell, type `pc-health-remote.exe --link-telegram <CODE>` | "2. paste the code on the PC" |
| 13-16 s | Restart the backend from the tray | "3. restart" |
| 16-20 s | First alert arrives on the phone | "Done" |
| 20-22 s | End card: "Free tier, no Flipper needed" | - |

Blur or crop the code if the clip is filmed before it expires (valid 10 minutes, one-time use).

### Video C: "Flipper + phone" (28 s)

| Time | Shot | On-screen text / VO |
|---|---|---|
| 0-4 s | Flipper Zero on the desk showing the Temps page | "My Flipper watches my PC" |
| 4-9 s | RAM fills up (open many browser tabs / a heavy app); Flipper vibrates, alert screen with value vs limit | "RAM 90% -> Flipper buzzes" |
| 9-12 s | Walk out of the room, Flipper stays on the desk | "But I'm not at my desk" |
| 12-18 s | Phone in hand: Telegram `🔥 GAMING-PC: RAM 91% (limit 90%)` arrives | "Same alert in Telegram" |
| 18-24 s | Quick cut: GitHub repo page, "MIT" badge | "Open source" |
| 24-28 s | End card: bot name, "Flipper optional" | - |

## 3. Post drafts

### 3a. GitHub release notes (append to the next release, or edit v1.1.0)

```markdown
## Telegram alerts (beta)

Get your PC alerts in Telegram, with or without a Flipper Zero.

1. Open the bot: https://t.me/PCHealthRemoteBot?start=src_github_release and send /link
2. On the PC: `pc-health-remote.exe --link-telegram <CODE>`
3. Restart the backend.

Alerts look like `🔥 GAMING-PC: CPU temp 92°C (limit 90°C)` and use the same 9 rules as the Flipper app.

| | Free | Pro |
|---|---|---|
| PCs | 1 | 5 |
| Alerts per day | 10 | unlimited |
| Price | 0 | 99 Telegram Stars / 30 days |

The bot stores only chat id, language, source tag, device keys, PC names, daily counters and payment records.
No temperature history. Details: docs/TELEGRAM.md. Feedback and bug reports: Issues.
```

### 3b. r/flipperzero

Guidance (not verified rules): read the subreddit sidebar/rules on the day of posting and use the flair it asks for.
General Reddit norms: say plainly that you are the developer, lead with the free open-source Flipper app (the thing the
community cares about), keep the paid part to one line, reply to comments, do not repost the same thing in many subs on
the same day, and do not ask friends to upvote.

**Title:** I made a Flipper app that shows PC temps and buzzes when something overheats (open source), now with optional Telegram alerts

**Body:**

> Hi, I'm the developer of PC Health Remote. It's a free, MIT-licensed Flipper Zero app plus a small Windows backend
> (Rust). The Flipper shows CPU/GPU temps and load, RAM/VRAM, fans, disk, battery, and vibrates / beeps / flashes the
> LED when one of 9 rules fires (CPU 90 °C, RAM 90 % for 10 s, PC link lost, ...). Thresholds and signals are
> adjustable on the Flipper. Works over BLE or USB, official firmware and RogueMaster.
>
> New in v1.1.0: the same alerts can go to Telegram, for when the Flipper is on the desk and you are not. Free tier is
> 1 PC and 10 alerts a day; there is an optional paid tier (99 Stars / 30 days) for more PCs and no daily limit. The
> Flipper app itself stays free.
>
> Repo + release: https://github.com/ataman-lab/pc-health-remote
> Bot (optional): https://t.me/PCHealthRemoteBot?start=src_reddit_flipper
>
> Known limits: GPU values are NVIDIA only; best CPU temps need LibreHardwareMonitor. Hardware reports (firmware,
> Windows version, GPU) are very welcome.

### 3c. Flipper forum (forum.flipper.net)

Guidance: post in the category the forum uses for user apps/projects (check on the day); one thread, update it rather
than opening new ones.

**Title:** PC Health Remote: PC temps and alerts on the Flipper (BLE/USB), optional Telegram alerts

**Body:**

> PC Health Remote is an open-source (MIT) Flipper app plus a Windows backend that streams PC sensors to the Flipper
> over Bluetooth LE or USB.
>
> - Temps page: CPU/GPU temperature, CPU/GPU/RAM/VRAM load
> - Details page: RAM/VRAM totals, CPU clock, fan RPM, disk %, battery, uptime, top CPU and RAM process
> - 9 alert rules, each with its own threshold and signal (Vibro, Sound, Vib+Snd, LED, Off); OK snoozes 10 min
> - Pair once, silent reconnects; settings on the SD card
> - Official firmware (API 87.1) and RogueMaster (API 88.4)
>
> Optional: the backend can also send the same alerts to Telegram via
> https://t.me/PCHealthRemoteBot?start=src_flipper_forum (free: 1 PC, 10 alerts/day; Pro 99 Stars / 30 days for 5 PCs
> and no limit). The Flipper part does not need it.
>
> Download: https://github.com/ataman-lab/pc-health-remote/releases. The wire protocol is documented in
> docs/PROTOCOL.md. Bug reports with firmware version and hardware are appreciated.

### 3d. Russian Telegram channel post

> **Ваш ПК пишет вам в Telegram, когда перегревается** 🔥
>
> PC Health Remote — открытый (MIT) бэкенд для Windows, который следит за температурой и нагрузкой ПК и присылает
> уведомления в бот @PCHealthRemoteBot. Flipper Zero не обязателен (но если он есть, тревоги будут и на нём).
>
> Как подключить:
> 1. Откройте бота и отправьте /link — придёт код из 6 символов.
> 2. На ПК: `pc-health-remote.exe --link-telegram КОД`
> 3. Перезапустите программу.
>
> Пример уведомления: `🔥 GAMING-PC: CPU temp 92°C (limit 90°C)`
>
> Бесплатно: 1 ПК, 10 уведомлений в сутки. Pro: до 5 ПК и без лимита, 99 Stars за 30 дней.
> Бот хранит только id чата, язык, метку источника, ключи устройств, имена ПК и счётчики. Истории температур нет.
>
> Бот: https://t.me/PCHealthRemoteBot?start=src_friends
> Код: https://github.com/ataman-lab/pc-health-remote

(Swap `src_friends` for a channel-specific tag such as `src_tg_<channel>` if the post goes to a channel you do not own;
any tag of letters, digits, `_`, `-` up to 32 chars is recorded.)

### r/pcmasterrace (tag exists, no draft)

Guidance: large subs usually restrict self-promotion; check the rules first. If posting, prefer a useful
"how I monitor temps when AFK" post or comment and mention the tool only when relevant. If the rules forbid it, skip;
the tag stays unused.

## 4. Budget: $10 (estimate) and kill line

All amounts are estimates, not quotes; check the ad platform minimums before spending.

| Item | Est. $ | Notes |
|---|---|---|
| Organic posts (GitHub, r/flipperzero, Flipper forum, RU channel, friends) | 0 | Main bet |
| TikTok: 3 videos organic | 0 | Videos A-C |
| Boost the best-performing video (TikTok Promote or similar) | 5 | Only after 48 h, only the video with most views |
| Telegram: paid post in one small PC/Flipper RU channel, or Telegram Ads if its minimum fits | 5 | If neither fits in $5, move it to the video boost |
| **Total** | **10** | |

**Kill line:** if after **$10 spent and 7 days** from the first post `/stats` shows **0 Stars** (zero Pro payments),
stop spending and rethink price and features (for example: lower price, a different Pro feature, longer free tier),
before any further budget. Write the result into the issue.

## 5. What to watch in `/stats`

Funnel per source: **opened -> linked a PC -> got an alert -> paid**, plus **still linked after 7 days**.

What `/stats` (admin only, `ADMIN_CHAT_ID`) prints today:

```
Users: N        all user:* records
PCs: N          total linked PCs, all sources together
Pro: N          users with an active Pro now
Stars: N        Stars from non-refunded payments
<src>: users N, pro N, stars N    one line per source tag ("-" = no tag)
```

| Funnel step | Shown by `/stats` now? | Notes |
|---|---|---|
| Opened (pressed Start) | **Yes, per source** (`users`) | Also includes users who only sent `/link` (counted under `-` or their old tag) |
| Linked a PC | **Total only** (`PCs`), not per source | `user.pcs` exists per user, so a per-source count is a small change in `stats()` |
| Got an alert | **No** | Free counters live 48 h (Durable Object/KV) and are not reported; Pro users have no counter at all |
| Paid | **Yes, per source** (`pro` active now, `stars` from `pay:` records with `src`) | |
| Still linked after 7 days | **No** | No link or first-seen timestamp is stored; only current state is known |

**Gap (no code changed):** to see the full funnel, `stats()` would need per-source "users with >= 1 PC", a persistent
per-user "first alert" flag, and a `linked_at` timestamp per PC for 7-day retention. Until then, take a manual
`/stats` snapshot on day 0, day 3 and day 7 and compare PCs and per-source users by hand.
