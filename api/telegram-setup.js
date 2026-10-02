// Одноразовая настройка: открыть в браузере https://<сайт>/api/telegram-setup?key=<BOT_SECRET>
// Подключает вебхук бота к этому сайту и задаёт меню команд. Можно открывать повторно.
const crypto = require('crypto');
const { tg } = require('./_lib/telegram');
const { baseUrl } = require('./_lib/generate');

const REQUIRED = ['TELEGRAM_BOT_TOKEN', 'BOT_SECRET', 'FAL_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];

function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) { res.status(500).json({ error: `Не заданы переменные окружения: ${missing.join(', ')}` }); return; }
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(process.env.BOT_SECRET)) {
    res.status(500).json({ error: 'BOT_SECRET: 16–256 символов, только латиница, цифры, _ и -' });
    return;
  }
  if (!sameSecret((req.query || {}).key, process.env.BOT_SECRET)) { res.status(401).json({ error: 'Неверный key' }); return; }

  try {
    const url = `${baseUrl(req)}/api/telegram`;
    await tg('setWebhook', {
      url,
      secret_token: process.env.BOT_SECRET,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query']
    });
    await tg('setMyCommands', {
      commands: [
        { command: 'start', description: 'Начать' },
        { command: 'buy', description: 'Купить генерации' },
        { command: 'balance', description: 'Баланс' },
        { command: 'paysupport', description: 'Вопросы по оплате' },
        { command: 'help', description: 'Как пользоваться' }
      ]
    });
    const me = await tg('getMe');
    res.status(200).json({ ok: true, bot: `@${me.username}`, webhook: url });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
