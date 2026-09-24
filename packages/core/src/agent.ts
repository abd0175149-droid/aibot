import type {
  AiProvider, Content, GenerateResult, ModelUsage, ToolCall, ToolDeclaration,
} from '@aibot/ai';
import type { OutboundMessage } from '@aibot/shared';
import { applyGuards, type GuardContext } from './guards.js';

/**
 * حلقة الوكيل — منقولةٌ من الإنتاج بصيغتها المجرَّبة.
 *
 * نقاط لا تُمَسّ (كلّها دروسٌ مدفوعة الثمن):
 *  ① أجزاء ردّ النموذج تُعاد إلى السجلّ **حرفيّاً كما وصلت**. تجريد
 *     `thoughtSignature` من `functionCall` يجعل الـAPI يرفض النداء التالي.
 *  ② الاستدعاءات المتوازية مدعومة: كلّ نتائج الدورة تُعاد في رسالةٍ واحدة
 *     **بنفس الترتيب** الذي طُلبت به.
 *  ③ عند بلوغ آخر دورة: نصٌّ مطمئن بدل الصمت.
 *  ④ حارس التسريب يطلب إعادة صياغةٍ **واحدة**، وفقط إن لم تُنفَّذ أداةٌ بعد —
 *     بعد تنفيذ أداةٍ تُضيّع إعادةُ الصياغة نتيجتَها، وذلك أسوأ من التسريب.
 */

export interface ToolExecutor {
  (call: ToolCall): Promise<{
    result: unknown;
    /** رسائل تُرسل للزبون مباشرةً (أزرار تأكيد مثلاً) بدل أن يصوغها النموذج. */
    emit?: OutboundMessage[];
    /** فعلٌ خطر نُفِّذ خلف معالجٍ حتميّ — يُسجَّل في أعلام التشغيل. */
    handoff?: boolean;
    failed?: boolean;
  }>;
}

export interface RunAgentInput {
  provider: AiProvider;
  apiKey: string;
  model: string;
  system: string;
  contents: Content[];
  tools: ToolDeclaration[];
  execTool: ToolExecutor;
  maxLoops: number;
  guard: Omit<GuardContext, 'toolExecuted'>;
  fallbackText: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  text: string;
  emits: OutboundMessage[];
  usage: ModelUsage;
  calls: number;
  toolsUsed: string[];
  flags: {
    handoff: boolean; unknown: boolean; leak: boolean; fail: boolean;
    truncated: boolean; repeated: boolean; privacy: boolean; maxLoops: boolean;
    /**
     * ★ النموذج لم يُخرج شيئاً فحلّ نصُّ العجز مكانه.
     *
     *   وهذا العلَم لازمٌ لأنّ نصّ العجز الافتراضيّ **يَعِد**: «بحوّلك لموظّف».
     *   وكان لا يحوّل أحداً — لا `needsAttention` ولا سطرٌ في أيّ شاشة. أي
     *   أنّ الحالةَ الوحيدةَ التي يُعترف فيها بالعجز هي الحالةُ الوحيدةُ التي
     *   لا يعلمها أحد. ولا يُستنتَج من النصّ: العميل يكتب نصَّ عجزه بنفسه
     *   في `failMessage` فلا نمطَ يُطابَق.
     */
    usedFallback: boolean;
  };
  latencyMs: number;
}

const UNKNOWN_HINT = /لا أعرف|ما بعرف|لا أملك هذه المعلومة|ما عندي هذي المعلومة/;

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const started = Date.now();
  const contents: Content[] = [...input.contents];
  const usage: ModelUsage = {
    promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0,
  };
  const emits: OutboundMessage[] = [];
  const toolsUsed: string[] = [];
  const flags = {
    handoff: false, unknown: false, leak: false, fail: false,
    truncated: false, repeated: false, privacy: false, maxLoops: false,
    usedFallback: false,
  };

  let calls = 0;
  let toolExecuted = false;
  let retriedOnce = false;
  let text = '';

  for (let loop = 0; loop <= input.maxLoops; loop++) {
    const isLast = loop === input.maxLoops;
    const res: GenerateResult = await input.provider.generate({
      system: input.system,
      contents,
      // ③ في الدورة الأخيرة تُسحب الأدوات فيُجبَر النموذج على نصٍّ نهائيّ
      tools: isLast ? [] : input.tools,
      model: input.model,
      temperature: input.temperature,
      signal: input.signal,
    }, input.apiKey);

    calls++;
    accumulate(usage, res.usage);

    if (!res.toolCalls.length) {
      text = res.text;
      const guarded = applyGuards(text, { ...input.guard, toolExecuted });
      flags.leak ||= guarded.flags.leak;
      flags.truncated ||= guarded.flags.truncated;
      flags.repeated ||= guarded.flags.repeated;
      flags.privacy ||= guarded.flags.privacy;

      // ④ إعادة صياغةٍ واحدة، وفقط إن لم تُنفَّذ أداةٌ بعد
      if (guarded.needsRetry && !retriedOnce && !isLast) {
        retriedOnce = true;
        contents.push({ role: 'model', parts: res.rawParts } as Content);
        contents.push({
          role: 'user',
          parts: [{ text: 'أعِد صياغة ردّك للزبون بلغةٍ بشريّة، بلا أسماء أدواتٍ ولا كتل كود.' }],
        });
        continue;
      }
      text = guarded.text;
      break;
    }

    // ① الأجزاء حرفيّاً كما وصلت
    contents.push({ role: 'model', parts: res.rawParts } as Content);

    // ② التنفيذ المتوازي، والنتائج بنفس الترتيب
    const results = await Promise.all(res.toolCalls.map(async (c) => {
      toolsUsed.push(c.name);
      try {
        return { call: c, out: await input.execTool(c) };
      } catch (e) {
        return { call: c, out: { result: { error: (e as Error).message }, failed: true } };
      }
    }));

    toolExecuted = true;
    for (const r of results) {
      if (r.out.emit?.length) emits.push(...r.out.emit);
      if (r.out.handoff) flags.handoff = true;
      if (r.out.failed) flags.fail = true;
    }

    contents.push({
      role: 'tool',
      parts: results.map((r) => ({ name: r.call.name, response: r.out.result })),
    });

    if (isLast) flags.maxLoops = true;
  }

  if (!text.trim() && !emits.length) {
    text = input.fallbackText;
    flags.usedFallback = true;
  }
  flags.unknown = UNKNOWN_HINT.test(text);

  return {
    text, emits, usage, calls,
    toolsUsed: [...new Set(toolsUsed)],
    flags,
    latencyMs: Date.now() - started,
  };
}

function accumulate(into: ModelUsage, add: ModelUsage): void {
  into.promptTokens += add.promptTokens;
  into.outputTokens += add.outputTokens;
  into.thoughtsTokens += add.thoughtsTokens;
  into.cachedTokens += add.cachedTokens;
  into.totalTokens += add.totalTokens;
}
