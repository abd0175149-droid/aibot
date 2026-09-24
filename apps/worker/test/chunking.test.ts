import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/embed.js';
import { estimateTokens } from '@aibot/core';

/**
 * ★ العطل الذي وُلد منه هذا الملفّ: التقطيع كان يقسم على **الأسطر الفارغة**
 *   وحدها. وملفّ Excel يُحوَّل إلى سطرٍ لكلّ صفٍّ بلا سطرٍ فارغ، فيصير القسمُ
 *   كلُّه فقرةً واحدةً بآلاف التوكنز تُدفع مقطعاً واحداً.
 *
 *   وذلك المقطع يُقصّ عند التضمين فيمثّل أوّل الأصناف وحدها، ثمّ **لا يمرّ من
 *   `fitChunks` أبداً** لأنّه أكبر من الميزانية كلّها. فقائمةُ الأسعار تختفي
 *   من البوت بعد رفعها بنجاح، والشاشة تقول «استُخرج نصُّه».
 *
 *   ولا يُمسَك هذا إلّا بنصٍّ **بلا أسطر فارغة** — وهو ما لا يكتبه أحدٌ في
 *   اختبارٍ إلّا قصداً.
 */
describe('التقطيع لا يُخرج مقطعاً أكبر من الهدف', () => {
  const TARGET = 800;
  const tooBig = (b: string) => estimateTokens(b) > TARGET * 1.6;

  it('★ جدولُ أسعارٍ بلا سطرٍ فارغ — الحالةُ التي كانت تُنتج مقطعاً واحداً ضخماً', () => {
    const menu = Array.from({ length: 400 }, (_, i) =>
      `الصنف: طبق رقم ${i} · السعر: ${3 + i} دينار · الوصف: وجبة كاملة تكفي شخصاً`).join('\n');
    expect(estimateTokens(menu)).toBeGreaterThan(5_000);

    const chunks = chunkText(menu, TARGET);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.filter((c) => tooBig(c.body))).toEqual([]);

    // ولا يضيع صنف: آخرُ الأصناف موجودٌ كما أوّلها
    const all = chunks.map((c) => c.body).join('\n');
    expect(all).toContain('طبق رقم 0');
    expect(all).toContain('طبق رقم 399');
  });

  it('فقرةٌ واحدةٌ طويلةٌ بلا أسطر — نصُّ PDF المستخرَج', () => {
    const para = 'هذه جملةٌ توضيحيّةٌ عن الخدمة وتفاصيلها. '.repeat(600);
    const chunks = chunkText(para, TARGET);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.filter((c) => tooBig(c.body))).toEqual([]);
  });

  it('نصٌّ بلا فواصلَ إطلاقاً — يُقصّ على الحروف ولا يُترك ضخماً', () => {
    const blob = 'أ'.repeat(40_000);
    const chunks = chunkText(blob, TARGET);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.filter((c) => tooBig(c.body))).toEqual([]);
  });

  it('والنصُّ العاديُّ لا يتغيّر سلوكُه — الفقراتُ تبقى فقرات', () => {
    const normal = ['# الأسعار', 'الوجبة الأولى بعشرة دنانير.', '', 'الوجبة الثانية باثني عشر.'].join('\n');
    const chunks = chunkText(normal, TARGET);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBe('الأسعار');
    expect(chunks[0]!.body).toContain('الوجبة الثانية');
  });
});
