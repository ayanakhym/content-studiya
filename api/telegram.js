// Вебхук Telegram-бота: сюда Telegram присылает все сообщения и оплаты.
const cfg = require('./_lib/config');
const db = require('./_lib/db');
const { tg, send, fill } = require('./_lib/telegram');
const { startGeneration, buyKeyboard, baseUrl } = require('./_lib/generate');

const genKeyboard = { inline_keyboard: [[{ text: '✨ Сгенерировать', callback_data: 'gen' }]] };

function findPack(payload) {
  const id = String(payload || '').replace(/^pack:/, '');
  return cfg.PACKS.find(p => p.id === id);
}

async function sendInvoice(chatId, pack) {
  await tg('sendInvoice', {
    chat_id: chatId,
    title: `Пакет генераций: ${pack.credits}`,
    description: `Генераций картинок по шаблону: ${pack.credits}`,
    payload: `pack:${pack.id}`,
    currency: 'XTR',
    prices: [{ label: `Генераций: ${pack.credits}`, amount: pack.stars }]
  });
}

async function onPhoto(msg, fileId, base) {
  const chatId = msg.chat.id;
  if (cfg.MAX_PHOTOS <= 1) {
    await startGeneration(chatId, base, [fileId]);
    return;
  }
  const r = await db.addPhoto(chatId, fileId, msg.media_group_id || null, cfg.MAX_PHOTOS, cfg.FREE_CREDITS);
  // На альбом из нескольких фото отвечаем один раз, а не на каждое фото.
  if (r.new_group) {
    await send(chatId, fill(cfg.TEXTS.received, { count: r.cnt, max: cfg.MAX_PHOTOS }), { reply_markup: genKeyboard });
  }
}

async function onPayment(msg, base) {
  const chatId = msg.chat.id;
  const p = msg.successful_payment;
  const pack = findPack(p.invoice_payload);
  if (!pack || p.currency !== 'XTR') {
    console.error('Unknown payment', p);
    return;
  }
  const balance = await db.addPayment(p.telegram_payment_charge_id, chatId, p.total_amount, pack.credits);
  if (balance === null) return; // этот платёж уже учтён
  await send(chatId, fill(cfg.TEXTS.paid, { credits: pack.credits, balance }));
  // Если клиент прислал фото до оплаты — сразу запускаем генерацию.
  const user = await db.getUser(chatId, cfg.FREE_CREDITS);
  if ((user.pending || []).length >= cfg.MIN_PHOTOS) await startGeneration(chatId, base);
}

async function onCommand(msg) {
  const chatId = msg.chat.id;
  const cmd = (msg.text || '').trim().split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/start' || cmd === '/balance') {
    const user = await db.getUser(chatId, cfg.FREE_CREDITS);
    const text = cmd === '/start' ? cfg.TEXTS.start : cfg.TEXTS.balance;
    await send(chatId, fill(text, { credits: user.credits }), cmd === '/start' && user.credits < 1 ? { reply_markup: buyKeyboard() } : {});
  } else if (cmd === '/buy') {
    await send(chatId, 'Выберите пакет:', { reply_markup: buyKeyboard() });
  } else if (cmd === '/paysupport') {
    await send(chatId, fill(cfg.TEXTS.paysupport, { contact: cfg.SUPPORT_CONTACT }));
  } else {
    await send(chatId, cfg.TEXTS.help);
  }
}

async function handle(update, base) {
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    const pack = findPack(q.invoice_payload);
    const ok = !!pack && q.currency === 'XTR' && q.total_amount === pack.stars;
    await tg('answerPreCheckoutQuery', ok
      ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: 'Пакет не найден, откройте /buy заново.' });
    return;
  }

  if (update.callback_query) {
    const q = update.callback_query;
    const chatId = q.message && q.message.chat.id;
    await tg('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
    if (!chatId) return;
    if (q.data === 'gen') await startGeneration(chatId, base);
    else if (q.data && q.data.startsWith('buy:')) {
      const pack = findPack(q.data.slice(4));
      if (pack) await sendInvoice(chatId, pack);
    }
    return;
  }

  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return;

  if (msg.successful_payment) return onPayment(msg, base);
  if (msg.photo && msg.photo.length) return onPhoto(msg, msg.photo[msg.photo.length - 1].file_id, base);
  if (msg.document && /^image\//.test(msg.document.mime_type || '')) return onPhoto(msg, msg.document.file_id, base);
  if (msg.text) return onCommand(msg);
  await send(msg.chat.id, cfg.TEXTS.help);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!process.env.BOT_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== process.env.BOT_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let update = req.body;
  if (typeof update === 'string') { try { update = JSON.parse(update); } catch (e) { update = null; } }

  try {
    if (update) await handle(update, baseUrl(req));
  } catch (e) {
    console.error('telegram update failed', e);
  }
  // Всегда 200: иначе Telegram будет бесконечно повторять то же сообщение.
  res.status(200).json({ ok: true });
};
