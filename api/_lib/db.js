// Вызовы SQL-функций Supabase (см. supabase/bot-schema.sql) через REST, без SDK.
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;

async function rpc(fn, args) {
  const headers = { 'content-type': 'application/json', apikey: KEY };
  // Старые ключи service_role — это JWT, их нужно передать ещё и в Authorization.
  if (KEY && KEY.startsWith('eyJ')) headers.authorization = `Bearer ${KEY}`;
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${fn}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const first = rows => (Array.isArray(rows) ? rows[0] : rows);

module.exports = {
  // → { credits, pending }
  getUser: async (chatId, freeCredits) => first(await rpc('bot_get_user', { p_chat: chatId, p_free: freeCredits })),
  // → { cnt, new_group }
  addPhoto: async (chatId, fileId, group, max, freeCredits) =>
    first(await rpc('bot_add_photo', { p_chat: chatId, p_file: fileId, p_group: group, p_max: max, p_free: freeCredits })),
  // → { status: 'ok' | 'no_photos' | 'no_credits', files, credits }
  // files — фото для этой генерации; null → взять накопленные
  startJob: async (chatId, jobId, minPhotos, files, freeCredits) =>
    first(await rpc('bot_start_job', { p_chat: chatId, p_job: jobId, p_min: minPhotos, p_files: files || null, p_free: freeCredits })),
  // → chat_id задания, если оно ещё не закрыто, иначе null
  jobChat: (jobId) => rpc('bot_job_chat', { p_job: jobId }),
  // → { chat_id, credits } или пусто, если задание уже обработано
  finishJob: async (jobId, ok) => first(await rpc('bot_finish_job', { p_job: jobId, p_ok: ok })),
  // → новый баланс или null, если этот платёж уже был учтён
  addPayment: (chargeId, chatId, stars, credits) =>
    rpc('bot_add_payment', { p_charge: chargeId, p_chat: chatId, p_stars: stars, p_credits: credits })
};
