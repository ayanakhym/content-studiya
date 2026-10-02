const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');
const { send, fill, fileAsDataUri } = require('./telegram');

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function sign(jobId) {
  return crypto.createHmac('sha256', process.env.BOT_SECRET || '').update(String(jobId)).digest('hex');
}

function checkSign(jobId, sig) {
  const a = Buffer.from(sign(jobId));
  const b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  return `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

function buyKeyboard() {
  return {
    inline_keyboard: cfg.PACKS.map(p => [
      { text: `${p.credits} ген. — ${p.stars} ⭐`, callback_data: `buy:${p.id}` }
    ])
  };
}

// Списывает 1 кредит и отправляет задание в fal.ai. files — фото для генерации;
// без него берутся накопленные. Результат придёт в api/fal-webhook.js.
async function startGeneration(chatId, base, files) {
  const jobId = crypto.randomUUID();
  const job = await db.startJob(chatId, jobId, cfg.MIN_PHOTOS, files, cfg.FREE_CREDITS);

  if (job.status === 'no_photos') {
    await send(chatId, fill(cfg.TEXTS.needPhotos, { min: cfg.MIN_PHOTOS }));
    return;
  }
  if (job.status === 'no_credits') {
    await send(chatId, cfg.TEXTS.noCredits, { reply_markup: buyKeyboard() });
    return;
  }

  await send(chatId, cfg.TEXTS.started);
  try {
    const imageUrls = await Promise.all(job.files.map(f => fileAsDataUri(f, MAX_FILE_BYTES)));
    const webhook = `${base}/api/fal-webhook?job=${jobId}&sig=${sign(jobId)}`;
    const r = await fetch(`https://queue.fal.run/${cfg.FAL_MODEL}?fal_webhook=${encodeURIComponent(webhook)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Key ${process.env.FAL_KEY}` },
      body: JSON.stringify({ ...cfg.FAL_INPUT, prompt: cfg.TEMPLATE_PROMPT, image_urls: imageUrls })
    });
    if (!r.ok) throw new Error(`fal submit: ${r.status} ${await r.text()}`);
  } catch (e) {
    console.error('startGeneration', e);
    const refunded = await db.finishJob(jobId, false);
    if (refunded) await send(chatId, e.code === 'TOO_BIG' ? cfg.TEXTS.tooBig : cfg.TEXTS.failed);
  }
}

module.exports = { startGeneration, buyKeyboard, baseUrl, checkSign };
