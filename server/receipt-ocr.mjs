import { readFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const RECEIPT_PARSE_PROMPT = `You are parsing an Israeli supermarket receipt (Hebrew RTL).
Extract JSON only with this shape:
{
  "storeName": string,
  "tripDate": "YYYY-MM-DD" or ISO datetime if time visible,
  "totalAmount": number,
  "items": [
    {
      "barcode": "EAN-13 or PLU code or null",
      "name": "product name in Hebrew",
      "quantity": number (default 1),
      "unitPrice": number,
      "lineTotal": number,
      "isWeighed": boolean,
      "weightKg": number or null
    }
  ]
}
Include discount lines as negative lineTotal. Skip payment/tax footer lines.`;

export function getReceiptOcrConfig() {
  const provider = (
    process.env.RECEIPT_OCR_PROVIDER ?? 'ollama'
  ).toLowerCase();

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    return {
      provider: 'gemini',
      model: process.env.GEMINI_RECEIPT_MODEL ?? 'gemini-2.0-flash',
      baseUrl: 'https://aistudio.google.com',
      configured: Boolean(apiKey),
    };
  }

  const baseUrl = (
    process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  ).replace(/\/$/, '');
  return {
    provider: 'ollama',
    model: process.env.OLLAMA_VISION_MODEL ?? 'llava',
    baseUrl,
    configured: true,
  };
}

export async function checkReceiptOcrAvailable() {
  const cfg = getReceiptOcrConfig();
  if (cfg.provider === 'gemini') return cfg.configured;
  try {
    const res = await fetch(`${cfg.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function parseModelJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(raw);
}

async function visionChat(base64, mimeType, prompt, { json = true } = {}) {
  const cfg = getReceiptOcrConfig();
  if (cfg.provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      const err = new Error(
        'Vision OCR: set GEMINI_API_KEY in .env or use RECEIPT_OCR_PROVIDER=ollama',
      );
      err.status = 503;
      throw err;
    }
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: cfg.model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: base64,
              },
            },
          ],
        },
      ],
    });
    const text =
      response.text ??
      response.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ??
      '';
    if (!text) {
      const err = new Error('Gemini returned empty vision response');
      err.status = 502;
      throw err;
    }
    return json ? parseModelJson(text) : text.trim();
  }

  const res = await fetch(`${cfg.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      ...(json ? { format: 'json' } : {}),
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [base64],
        },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(
      `Ollama request failed (${res.status}). Is Ollama running at ${cfg.baseUrl}? Model: ${cfg.model}. ${body.slice(0, 200)}`,
    );
    err.status = 503;
    throw err;
  }

  const data = await res.json();
  const text = data.message?.content ?? data.response ?? '';
  if (!text) {
    const err = new Error(
      `Ollama returned empty response. Try: ollama pull ${cfg.model}`,
    );
    err.status = 502;
    throw err;
  }
  return json ? parseModelJson(text) : text.trim();
}

async function parseWithOllama(base64, prompt = RECEIPT_PARSE_PROMPT) {
  return visionChat(base64, 'image/jpeg', prompt, { json: true });
}

async function parseWithGemini(base64, mimeType, prompt = RECEIPT_PARSE_PROMPT) {
  return visionChat(base64, mimeType, prompt, { json: true });
}

/** Parse image/PDF scan buffer with a custom vision prompt → JSON. */
export async function parseDocumentWithVision(buffer, mimeType, prompt) {
  const base64 = buffer.toString('base64');
  return visionChat(base64, mimeType, prompt, { json: true });
}

/** Vision OCR → plain text (no JSON mode). */
export async function transcribeDocumentWithVision(buffer, mimeType, prompt) {
  const base64 = buffer.toString('base64');
  return visionChat(base64, mimeType, prompt, { json: false });
}

/** Parse receipt image file → structured JSON (no DB enrichment). */
export async function parseReceiptFile(filePath, mimeType) {
  const cfg = getReceiptOcrConfig();
  const data = readFileSync(filePath);
  const base64 = data.toString('base64');

  if (cfg.provider === 'gemini') {
    return parseWithGemini(base64, mimeType);
  }
  return parseWithOllama(base64);
}
