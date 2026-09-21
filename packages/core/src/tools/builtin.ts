import type { ToolDeclaration } from '@aibot/ai';
import type { ChannelCapabilities, OutboundMessage } from '@aibot/shared';

/**
 * الأدوات الجاهزة — تعمل لأيّ نشاطٍ بلا إعداد.
 *
 * كلّ أداةٍ تُعلن **القدرات التي تحتاجها من القناة**. وحين تغيب القدرة،
 * الأداة **لا تُذكر في التعريفات إطلاقاً** — لا تُعطَّل. الفرق جوهريّ:
 * قاعدةٌ في الموجّه يستطيع النموذج كسرها، وأداةٌ غائبة لا وجود لها عنده.
 */

export interface BuiltinTool {
  key: string;
  description: string;
  parameters: Record<string, unknown>;
  requires: Array<keyof ChannelCapabilities | 'choices'>;
  /** فعلٌ خطر: يتحقّق ويرسل أزراراً، والتنفيذ معالجٌ حتميّ عند الضغط. */
  confirmRequired?: boolean;
}

const obj = (props: Record<string, unknown>, required: string[] = []) =>
  ({ type: 'object', properties: props, required });

const str = (description: string) => ({ type: 'string', description });

export const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    key: 'handoff_to_human',
    description:
      'حوّل المحادثة إلى موظّفٍ بشريّ. استعملها حين يطلب الزبون ذلك صراحةً، أو عند شكوى ' +
      'أو غضب، أو حين تعجز عن الإجابة مرّتين. اذكر السبب باختصار.',
    parameters: obj({ reason: str('سبب التحويل بكلماتٍ قليلة') }, ['reason']),
    requires: [],
  },
  {
    key: 'save_note',
    description: 'احفظ ملاحظةً على بطاقة الزبون ليقرأها الموظّفون لاحقاً.',
    parameters: obj({ note: str('الملاحظة') }, ['note']),
    requires: [],
  },
  {
    key: 'set_contact_attribute',
    description: 'سجّل معلومةً عن الزبون (مدينته، رقم عضويّته، تفضيلاته).',
    parameters: obj({ key: str('اسم الحقل'), value: str('القيمة') }, ['key', 'value']),
    requires: [],
  },
  {
    key: 'send_quick_options',
    description:
      'اعرض على الزبون خياراتٍ جاهزة ليختار منها بدل الكتابة. ' +
      'العنوان قصيرٌ جدّاً — بضع كلمات لا جملة.',
    parameters: obj({
      body: str('السؤال أو الجملة قبل الخيارات'),
      options: { type: 'array', items: { type: 'string' }, description: 'نصوص الخيارات' },
    }, ['body', 'options']),
    requires: ['choices'],
  },
  {
    key: 'ask_confirmation',
    description:
      'اطلب تأكيداً صريحاً قبل أيّ فعلٍ يكتب أو يدفع أو يلغي. ' +
      'أنت لا تُنفّذ الفعل — أنت تسأل فقط، والتنفيذ يجري حين يضغط الزبون.',
    parameters: obj({
      summary: str('ملخّص ما سيُنفَّذ، بالتفصيل الذي يحتاجه الزبون ليتأكّد'),
      action: str('معرّف الفعل'),
    }, ['summary', 'action']),
    requires: ['choices'],
    confirmRequired: true,
  },
  {
    key: 'send_location',
    description: 'أرسل موقع الفرع على الخريطة.',
    parameters: obj({ branch: str('اسم الفرع') }, ['branch']),
    requires: ['location'],
  },
  {
    key: 'check_business_hours',
    description: 'تحقّق إن كان النشاط مفتوحاً الآن، ومتى يفتح إن كان مغلقاً.',
    parameters: obj({}),
    requires: [],
  },
  {
    key: 'collect_lead',
    description: 'سجّل بيانات زبونٍ مهتمّ: الاسم والهاتف وما يطلبه.',
    parameters: obj({
      name: str('الاسم'), phone: str('الهاتف'), request: str('ما يطلبه'),
    }, ['name', 'request']),
    requires: [],
  },
  {
    key: 'search_knowledge',
    description:
      'ابحث في معرفة النشاط عن معلومةٍ لم تجدها فيما هو أمامك. ' +
      'استعملها قبل أن تقول «لا أعرف» — وصُغ البحث بكلماتٍ مختلفة عن سؤال الزبون.',
    parameters: obj({ query: str('ما تبحث عنه') }, ['query']),
    requires: [],
  },
  {
    key: 'escalate_complaint',
    description: 'سجّل شكوى رسميّة وحوّلها لموظّفٍ فوراً.',
    parameters: obj({
      summary: str('ملخّص الشكوى'), reference: str('رقم الطلب أو الحجز إن وُجد'),
    }, ['summary']),
    requires: [],
  },
];

/** هل تملك القناة ما تحتاجه هذه الأداة؟ */
function satisfied(tool: BuiltinTool, caps: ChannelCapabilities): boolean {
  return tool.requires.every((r) => {
    if (r === 'choices') return caps.buttons > 0 || caps.quickReplies > 0;
    const v = caps[r as keyof ChannelCapabilities];
    return typeof v === 'number' ? v > 0 : Boolean(v);
  });
}

/**
 * يبني تعريفات الأدوات للنموذج — **مرشَّحةً بقدرات القناة**.
 * على قناةٍ بلا موقع، `send_location` تختفي من التعريفات فلا يَعِد النموذج بما لا يملك.
 */
export function buildToolDeclarations(
  caps: ChannelCapabilities,
  enabledKeys: Set<string>,
  custom: Array<{ key: string; description: string; paramsSchema: Record<string, unknown>; requires: string[] }> = [],
): ToolDeclaration[] {
  const out: ToolDeclaration[] = [];

  for (const t of BUILTIN_TOOLS) {
    if (!enabledKeys.has(t.key)) continue;
    if (!satisfied(t, caps)) continue;
    out.push({ name: t.key, description: t.description, parameters: t.parameters });
  }

  for (const c of custom) {
    if (!enabledKeys.has(c.key)) continue;
    const ok = c.requires.every((r) =>
      r === 'choices' ? caps.buttons > 0 || caps.quickReplies > 0 : Boolean(caps[r as keyof ChannelCapabilities]));
    if (!ok) continue;
    out.push({ name: c.key, description: c.description, parameters: c.paramsSchema });
  }

  return out;
}

/** يحوّل نيّة «اعرض خيارات» إلى رسالةٍ صادرة تفهمها طبقة الإرسال. */
export function choicesMessage(body: string, options: string[], caps: ChannelCapabilities): OutboundMessage {
  const max = Math.max(caps.buttons, caps.quickReplies) || 3;
  return {
    kind: 'choices',
    body,
    options: options.slice(0, max).map((title, i) => ({
      id: `opt_${i}`,
      // القصّ هنا لا في الأداة: ميتا ترفض الرسالة كاملةً إن طال العنوان
      title: title.slice(0, caps.choiceTitleLen),
    })),
  };
}
