const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

export function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL).replace(/\/$/, '');
}

export async function ollamaChat(model, prompt, { format, timeoutMs = 120000 } = {}) {
  const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      ...(format ? { format } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(
      `Ollama failed (${res.status}) at ${getOllamaBaseUrl()}. Model: ${model}. ${body.slice(0, 200)}`,
    );
    err.status = 503;
    throw err;
  }

  const data = await res.json();
  const text = data.message?.content ?? data.response ?? '';
  if (!text) {
    const err = new Error(`Ollama returned empty response. Try: ollama pull ${model}`);
    err.status = 502;
    throw err;
  }
  return text;
}

export async function checkOllamaAvailable() {
  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function getAiInsightsConfig() {
  const provider = (
    process.env.AI_INSIGHTS_PROVIDER ??
    process.env.RECEIPT_OCR_PROVIDER ??
    'ollama'
  ).toLowerCase();

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    return {
      provider: 'gemini',
      model: process.env.GEMINI_INSIGHTS_MODEL ?? 'gemini-2.0-flash',
      baseUrl: 'https://aistudio.google.com',
      configured: Boolean(apiKey),
    };
  }

  return {
    provider: 'ollama',
    model:
      process.env.OLLAMA_TEXT_MODEL ??
      process.env.OLLAMA_VISION_MODEL ??
      'llama3.1:8b',
    baseUrl: getOllamaBaseUrl(),
    configured: true,
  };
}

export async function checkAiInsightsAvailable() {
  const cfg = getAiInsightsConfig();
  if (cfg.provider === 'gemini') return cfg.configured;
  return checkOllamaAvailable();
}

export async function generateTextWithGemini(prompt, model) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      'Set GEMINI_API_KEY in .env or use AI_INSIGHTS_PROVIDER=ollama',
    );
    err.status = 503;
    throw err;
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: model ?? process.env.GEMINI_INSIGHTS_MODEL ?? 'gemini-2.0-flash',
    contents: [{ parts: [{ text: prompt }] }],
  });

  const text =
    response.text ??
    response.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ??
    '';
  if (!text) {
    const err = new Error('Gemini returned empty response');
    err.status = 502;
    throw err;
  }
  return text;
}

export async function generateAiText(prompt) {
  const cfg = getAiInsightsConfig();
  if (cfg.provider === 'gemini') {
    return generateTextWithGemini(prompt, cfg.model);
  }
  return ollamaChat(cfg.model, prompt);
}
