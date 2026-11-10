// Bot profile through the official Bot API: description, short description and command menu per language,
// plus the profile photo. Shared file: identical copies in infra/knm-drill, infra/social-post/lib and
// pc-health-remote/telegram (keep them in sync). Each Worker calls applyProfile from an admin-only /brand command.
// profile = { default: 'uk', langs: { uk: { description, short, commands: [[command, text], ...] }, en: {...} } }
// The default language is sent without language_code, so it is what every other client language sees.
export const LIMITS = { description: 512, short: 120, command: 256 };

export function checkProfile(profile) {
  const errors = [];
  if (!profile.langs?.[profile.default]) errors.push('default language missing');
  for (const [lang, l] of Object.entries(profile.langs || {})) {
    if (!l.description || [...l.description].length > LIMITS.description) errors.push(`${lang}: description length`);
    if (!l.short || [...l.short].length > LIMITS.short) errors.push(`${lang}: short description length`);
    for (const [c, d] of l.commands || []) {
      if (!/^[a-z0-9_]{1,32}$/.test(c) || !d || [...d].length > LIMITS.command) errors.push(`${lang}: command ${c}`);
    }
  }
  return errors;
}

const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// Never throws and never returns Telegram's response text (it could echo the token URL). Returns failed step names.
export async function applyProfile({ token, profile, avatar, fetch: f = fetch }) {
  const failed = [];
  const call = async (step, method, init) => {
    try {
      const r = await f(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', ...init });
      if (!(await r.json())?.ok) failed.push(step);
    } catch { failed.push(step); }
  };
  const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (const [lang, l] of Object.entries(profile.langs)) {
    const code = lang === profile.default ? {} : { language_code: lang };
    await call(`description:${lang}`, 'setMyDescription', json({ description: l.description, ...code }));
    await call(`short:${lang}`, 'setMyShortDescription', json({ short_description: l.short, ...code }));
    if (l.commands) await call(`commands:${lang}`, 'setMyCommands', json({ commands: l.commands.map(([command, description]) => ({ command, description })), ...code }));
  }
  if (avatar) {
    const form = new FormData();
    form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
    form.append('avatar', new Blob([bytes(avatar)], { type: 'image/jpeg' }), 'avatar.jpg');
    await call('photo', 'setMyProfilePhoto', { body: form });
  }
  return failed;
}
