import { describe, it, expect } from 'vitest';
import { decideEnqueue } from '../src/enqueue';

/**
 * العطل الذي يحرسه هذا الملفّ: مهمّةٌ **مكتملة** بنفس المعرّف كانت تُترك،
 * وBullMQ يتجاهل `add` بمعرّفٍ موجود بصمت — فصارت كلّ محادثة تأخذ ردّاً
 * واحداً في عمرها كلّه. لا خطأ، لا سجلّ، لا شيء. اكتُشف على رسائل حقيقيّة.
 */
describe('قرار إعادة الجدولة — المعرّف الثابت لا يجوز أن يحجب ردّاً', () => {
  it('لا مهمّة بالمعرّف ⟵ أضِف', () => {
    expect(decideEnqueue(undefined)).toBe('add');
    expect(decideEnqueue('unknown')).toBe('add');
  });

  it('مؤجَّلة أو منتظرة ⟵ استبدل (وهذا هو الدمج نفسه)', () => {
    for (const s of ['delayed', 'waiting', 'waiting-children', 'prioritized']) {
      expect(decideEnqueue(s)).toBe('replace');
    }
  });

  it('★ مكتملة أو فاشلة ⟵ احذف ثمّ أضِف — وإلّا حُجز المعرّف إلى الأبد', () => {
    expect(decideEnqueue('completed')).toBe('clear-then-add');
    expect(decideEnqueue('failed')).toBe('clear-then-add');
  });

  it('★ قيد التنفيذ ⟵ علامةٌ لا مهمّة — والمهمّةُ الثانية كانت تعمل بالتوازي', () => {
    /* كان الجوابُ `sidecar`: مهمّةٌ ثانيةٌ بمعرّفٍ مستقلّ تنطلق بعد ثانيتين
       بينما نداءُ النموذج يستغرق من ثلاثٍ إلى عشرين — فتعمل **بالتوازي**.
       وقِيس التوازي فعلاً على طابورٍ مؤقّت: مهمّتان بمعرّفَين مختلفَين على
       المحادثة نفسها أعطتا `MAX_CONCURRENT_ON_SAME_CONVERSATION=2`. */
    expect(decideEnqueue('active')).toBe('mark-dirty');
  });

  it('★ ولا قيمةَ `sidecar` باقية — الاسمُ الذي يكذب أخطرُ من غيابه', () => {
    /* لو بقيت القيمةُ القديمة في `decideEnqueue` بينما يفحص `enqueueReply`
       الجديدةَ لصار فرعُ «قيد التوليد» ميتاً: رسالةٌ تصل أثناء التوليد
       تسقط في `clear-then-add` فتحذف مهمّةً **جارية**. */
    for (const st of ['active', 'delayed', 'waiting', 'completed', 'failed', undefined]) {
      expect(decideEnqueue(st)).not.toBe('sidecar');
    }
  });

  it('حالةٌ لا نعرفها تُعامَل كنهائيّة — الافتراض الآمن أن يُرسَل ردّ', () => {
    // الخطر الحقيقيّ صمتٌ لا تكرار: زبونٌ بلا ردّ أسوأ من ردَّين
    expect(decideEnqueue('some-future-state')).toBe('clear-then-add');
  });
});
