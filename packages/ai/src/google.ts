import type {
  AiProvider, EmbedInput, GenerateInput, GenerateResult, ToolCall, ModelUsage,
} from './types.js';
import { AiError } from './types.js';

const BASE = process.env.GOOGLE_AI_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';

/**
 * مزوّد Google — النماذج الافتراضيّة للمنصّة.
 *
 * التضمين: `gemini-embedding-001` بـ768 بُعداً.
 * وهو أفضل ما لدى جوجل للعربيّة (متعدّد اللغات، ويتصدّر MTEB في قسمه).
 * ⚠️ وثيقة 07 كانت تنصّ على `text-embedding-004` وهو موجَّهٌ للإنجليزيّة.
 */
export class GoogleProvider implements AiProvider {
  readonly name = 'google';

  async generate(input: GenerateInput, apiKey: string): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: input.contents.map(toGoogleContent),
      generationConfig: {
        temperature: input.temperature ?? 0.7,
        maxOutputTokens: input.maxOutputTokens ?? 1024,
      },
    };
    if (input.tools.length) {
      body.tools = [{
        functionDeclarations: input.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    const json = await call(
      `${BASE}/models/${encodeURIComponent(input.model)}:generateContent`,
      apiKey,
      body,
      input.signal,
    );

    const cand = json?.candidates?.[0];
    const parts: unknown[] = cand?.content?.parts ?? [];
    const toolCalls: ToolCall[] = [];
    let text = '';

    for (const [i, p] of parts.entries()) {
      const part = p as Record<string, any>;
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `${part.functionCall.name}#${i}`,
          name: String(part.functionCall.name),
          args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          raw: p, // حرفيّاً — تجريده يُفشل النداء التالي
        });
      }
    }

    const u = json?.usageMetadata ?? {};
    const usage: ModelUsage = {
      promptTokens: u.promptTokenCount ?? 0,
      outputTokens: u.candidatesTokenCount ?? 0,
      thoughtsTokens: u.thoughtsTokenCount ?? 0,
      cachedTokens: u.cachedContentTokenCount ?? 0,
      totalTokens: u.totalTokenCount ?? 0,
    };

    return {
      text: text.trim(),
      toolCalls,
      usage,
      rawParts: parts,
      finishReason: cand?.finishReason ?? null,
    };
  }

  async embed(input: EmbedInput, apiKey: string): Promise<number[][]> {
    if (!input.texts.length) return [];
    const dims = input.dimensions ?? 768;
    const json = await call(
      `${BASE}/models/${encodeURIComponent(input.model)}:batchEmbedContents`,
      apiKey,
      {
        requests: input.texts.map((t) => ({
          model: `models/${input.model}`,
          content: { parts: [{ text: t }] },
          taskType: input.taskType,
          outputDimensionality: dims,
        })),
      },
      input.signal,
    );
    const out = (json?.embeddings ?? []).map((e: { values: number[] }) => e.values);
    if (out.length !== input.texts.length) {
      throw new AiError('EMBED_COUNT', 'عدد المتجهات لا يطابق عدد النصوص', true);
    }
    // Matryoshka: الاقتطاع تحت البُعد الكامل يستلزم إعادة تطبيع، وإلّا فسدت المسافات.
    return out.map((v: number[]) => (dims < 3072 ? l2normalize(v) : v));
  }
}

/** تطبيع L2 — شرطٌ لصحّة مسافة cosine بعد اقتطاع Matryoshka. */
export function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  return n > 0 ? v.map((x) => x / n) : v;
}

function toGoogleContent(c: GenerateInput['contents'][number]): unknown {
  if (c.role === 'tool') {
    return {
      role: 'user', // Google يُعيد نتائج الأدوات بدور user
      parts: (c.parts as Array<{ name: string; response: unknown }>).map((p) => ({
        functionResponse: { name: p.name, response: { result: p.response } },
      })),
    };
  }
  if (c.role === 'model') return { role: 'model', parts: c.parts };
  return { role: 'user', parts: c.parts };
}

async function call(url: string, apiKey: string, body: unknown, signal?: AbortSignal): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new AiError('NETWORK', `تعذّر الوصول إلى المزوّد: ${(e as Error).message}`, true);
  }

  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    // 429 و5xx تُعاد المحاولة؛ 400 و403 فشلٌ دائم يُنتج حادثة
    throw new AiError(
      String(json?.error?.status ?? res.status),
      msg,
      res.status === 429 || res.status >= 500,
      res.status,
    );
  }

  // حجبُ المحتوى ليس خطأ شبكة — يُعامَل كردٍّ فارغ فيتولّى الحارس البقيّة
  if (json?.promptFeedback?.blockReason) {
    throw new AiError('BLOCKED', `حُجب الطلب: ${json.promptFeedback.blockReason}`, false, 200);
  }
  return json;
}
