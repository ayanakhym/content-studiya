// Serverless-функция Vercel. Ключ берётся из переменной окружения (Settings → Environment Variables).
// В браузер ключ не попадает.
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) { res.status(500).json({ error: 'ANTHROPIC_API_KEY не задан в настройках Vercel' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Bad request' }); return; }

  try {
    const payload = {
      model: body.model || 'claude-opus-4-8',
      max_tokens: body.max_tokens || 2400,
      messages: body.messages || []
    };
    if (body.tools) payload.tools = body.tools;

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
