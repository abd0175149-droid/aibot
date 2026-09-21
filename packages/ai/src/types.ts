/**
 * طبقة المزوّدين.
 * عزل المزوّد يجعل انقطاعه **خللاً لا كارثة**، ويجعل تبديل النموذج إعداداً
 * لا نشراً. والتسعير التاريخيّ لكلّ نموذجٍ على حدة يمنع انكسار الحساب عند التبديل.
 */

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * ما أعاده المزوّد مع النداء ويجب أن يُعاد إليه حرفيّاً.
   * ⚠️ تجريد `thoughtSignature` من `functionCall` يجعل الـAPI يرفض النداء التالي.
   *    لا تُعِد بناء هذا الكائن — مرّره كما وصل.
   */
  raw: unknown;
}

export interface ModelUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface GenerateResult {
  text: string;
  toolCalls: ToolCall[];
  usage: ModelUsage;
  /** أجزاء ردّ النموذج كما وصلت — تُعاد إلى السجلّ حرفيّاً في الدورة التالية. */
  rawParts: unknown;
  finishReason: string | null;
}

export type Content =
  | { role: 'user'; parts: Array<{ text: string }> }
  | { role: 'model'; parts: unknown }
  | { role: 'tool'; parts: Array<{ name: string; response: unknown }> };

export interface GenerateInput {
  system: string;
  contents: Content[];
  tools: ToolDeclaration[];
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface EmbedInput {
  texts: string[];
  model: string;
  /**
   * ⚠️ إلزاميّ ومختلفٌ بين الجهتين:
   *   RETRIEVAL_DOCUMENT للمقاطع · RETRIEVAL_QUERY للاستعلام.
   * خلطهما لا يُنتج خطأً — يُنتج ترتيباً أسوأ بصمت، وهو أكثر الأخطاء شيوعاً
   * في هذا النوع من الأنظمة.
   */
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY';
  dimensions?: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly name: string;
  generate(input: GenerateInput, apiKey: string): Promise<GenerateResult>;
  embed(input: EmbedInput, apiKey: string): Promise<number[][]>;
}

export class AiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
