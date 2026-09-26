import { fmt } from './useApi';

/**
 * ★ العددُ بصيغته العربيّة — مشتركٌ لكلّ الشاشات.
 *
 *   القاعدةُ كانت في شاشة البوت وحدها (`bot/parts.tsx`)، فكتبت لوحةُ المالك
 *   «4 حادثة مفتوحة» و«4 عميلاً» — تُقرأ ترجمةً آليّة (رُئيتا حيّاً، ٢٦ أيلول).
 *
 *   الصيغ: [واحد، اثنان، ٣–١٠ (جمعٌ مجرور)، ١١+ (مفردٌ منصوب)].
 *   والصفرُ يأخذ الجمع («0 حوادث») — لا المفردَ المنصوب («0 حادثةً»).
 */
export type Forms = [string, string, string, string];

export function arCount(n: number, forms: Forms): string {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  const m = n % 100;
  const word = n === 0 || (m >= 3 && m <= 10) ? forms[2] : forms[3];
  return `${fmt.num(n)} ${word}`;
}

export const INCIDENT_OPEN: Forms = ['حادثةٌ مفتوحةٌ واحدة', 'حادثتان مفتوحتان', 'حوادث مفتوحة', 'حادثةً مفتوحة'];
export const CLIENTS: Forms = ['عميلٌ واحد', 'عميلان', 'عملاء', 'عميلاً'];
