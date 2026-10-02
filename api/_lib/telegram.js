// Мини-клиент Telegram Bot API без зависимостей.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method, params) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {})
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || r.status}`);
  return data.result;
}

function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
}

const send = (chatId, text, extra) => tg('sendMessage', { chat_id: chatId, text, ...extra });

// Скачивает файл из Telegram и возвращает data URI — так токен бота не уходит в fal.ai.
async function fileAsDataUri(fileId, maxBytes) {
  const file = await tg('getFile', { file_id: fileId });
  if (maxBytes && file.file_size > maxBytes) throw Object.assign(new Error('too big'), { code: 'TOO_BIG' });
  const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
  if (!r.ok) throw new Error(`Telegram file download: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = (file.file_path.split('.').pop() || '').toLowerCase();
  const mime = { png: 'image/png', webp: 'image/webp', heic: 'image/heic' }[ext] || 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

module.exports = { tg, send, fill, fileAsDataUri };
