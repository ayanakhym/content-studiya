// Serverless-функция Vercel. Ключ берётся из переменной окружения (Settings → Environment Variables).
// В браузер ключ не попадает. Доступ открытый (без кода) — по ссылке.
const ALLOWED_MODELS = ['claude-opus-4-8'];
const MAX_TOKENS_CEILING = 4000;
const MAX_WEB_SEARCH_USES = 6;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) { res.status(500).json({ error: 'ANTHROPIC_API_KEY не задан в настройках Vercel' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Bad request' }); return; }

  try {
    const payload = {
      model: ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0],
      max_tokens: Math.min(Number(body.max_tokens) || 2400, MAX_TOKENS_CEILING),
      messages: Array.isArray(body.messages) ? body.messages : []
    };
    if (Array.isArray(body.tools) && body.tools.length) {
      const tools = body.tools
        .filter(t => t && t.type === 'web_search_20250305' && t.name === 'web_search')
        .map(t => ({ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(Number(t.max_uses) || MAX_WEB_SEARCH_USES, MAX_WEB_SEARCH_USES) }));
      if (tools.length) payload.tools = tools;
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('content-type', 'application/json');
    res.send(text);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
