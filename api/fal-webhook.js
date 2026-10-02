// Сюда fal.ai присылает готовую картинку (или ошибку) — бот отправляет её клиенту.
const cfg = require('./_lib/config');
const db = require('./_lib/db');
const { tg, send, fill } = require('./_lib/telegram');
const { checkSign } = require('./_lib/generate');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const { job, sig } = req.query || {};
  if (!job || !checkSign(job, sig)) { res.status(401).json({ error: 'Unauthorized' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }

  const images = (body && body.status === 'OK' && body.payload && body.payload.images) || [];
  const ok = images.length > 0;
  if (!ok) console.error('fal job failed', job, body && (body.error || body.payload_error));

  try {
    let delivered = false;
    if (ok) {
      const chatId = await db.jobChat(job);
      if (!chatId) { res.status(200).json({ ok: true, duplicate: true }); return; }
      try {
        for (const img of images) {
          // sendPhoto по ссылке принимает до 5 МБ; если больше — отправляем файлом.
          await tg('sendPhoto', { chat_id: chatId, photo: img.url })
            .catch(() => tg('sendDocument', { chat_id: chatId, document: img.url }));
        }
        delivered = true;
      } catch (e) {
        console.error('sending result failed', job, e);
      }
    }

    // Кредит списан окончательно, только если картинка дошла до клиента; иначе — возврат.
    const done = await db.finishJob(job, delivered);
    if (done) {
      await send(done.chat_id, delivered ? fill(cfg.TEXTS.done, { credits: done.credits }) : cfg.TEXTS.failed);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('fal webhook failed', e);
    // 500 → fal.ai повторит вебхук позже.
    res.status(500).json({ error: 'failed' });
  }
};
