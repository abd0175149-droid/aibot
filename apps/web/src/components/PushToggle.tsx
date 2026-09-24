'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { enablePush, disablePush, testPush, pushState, type PushState } from '@/lib/push';

/**
 * ★ مفتاح الإشعارات — ومعه زرُّ «جرّب» لا يقلّ عنه أهمّيّة.
 *
 *   قناةُ التنبيه تنكسر بصمت: مفتاحُ VAPID يتبدّل فتموت كلّ الاشتراكات بلا
 *   خطأ، والمستخدم يسحب الإذن من إعدادات المتصفّح فلا تعلم الصفحة، والاشتراك
 *   يُنظَّف عند أوّل دفعةٍ تعيد 410. ولا شيء من ذلك يظهر في شاشة. فالزرّان
 *   معاً: واحدٌ يشترك، وواحدٌ **يُثبت** أنّ الاشتراك يصل — قبل الحادثة لا بعدها.
 *
 * والحالات أربعٌ لا اثنتان: «غير مدعوم» و«محظور» رسالتان مختلفتان تماماً،
 * وخلطُهما يُنتج مستخدماً يبحث عن إعدادٍ لا وجود له.
 */
export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void pushState().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  async function run(kind: 'on' | 'off' | 'test', fn: () => Promise<void>, ok: string) {
    setBusy(kind);
    setMsg(null);
    try {
      await fn();
      setState(await pushState());
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof ApiError || e instanceof Error ? e.message : 'تعذّر تنفيذ الطلب.' });
    } finally {
      setBusy(null);
    }
  }

  // قبل أن تُعرف الحالة لا يُرسم شيء: زرٌّ يومض بين حالتين أسوأ من تأخّرٍ قصير
  if (state === null) return null;

  return (
    <div className="push-tg">
      <div className="push-hd">
        <span className="push-t">تنبيهات هذا الجهاز</span>
        <span className="push-s">
          {state === 'on' ? 'مفعَّلة' : state === 'denied' ? 'محظورة في المتصفّح' : state === 'unsupported' ? 'غير مدعومة هنا' : 'متوقّفة'}
        </span>
      </div>

      {state === 'unsupported' && (
        <p className="push-n">
          لتصلك التنبيهات على الآيفون: أضِف التطبيق إلى الشاشة الرئيسيّة ثمّ افتحه من هناك.
        </p>
      )}
      {state === 'denied' && (
        <p className="push-n">
          الإشعارات محظورةٌ لهذا الموقع في إعدادات متصفّحك. اسمح بها من هناك ثمّ أعِد فتح الصفحة.
        </p>
      )}

      {(state === 'off' || state === 'on') && (
        <div className="push-a">
          {state === 'off' ? (
            <Button size="sm" variant="primary" busy={busy === 'on'}
              onClick={() => void run('on', enablePush, 'فُعِّلت — وستصلك الحوادث الحرجة على هذا الجهاز.')}>
              فعّل الإشعارات
            </Button>
          ) : (
            <>
              <Button size="sm" busy={busy === 'test'}
                onClick={() => void run('test', testPush, 'أُرسل تنبيهٌ تجريبيّ — إن لم يصلك خلال ثوانٍ فالقناة مقطوعة.')}>
                جرّب الآن
              </Button>
              <Button size="sm" busy={busy === 'off'}
                onClick={() => void run('off', disablePush, 'أُوقفت على هذا الجهاز.')}>
                أوقفها
              </Button>
            </>
          )}
        </div>
      )}

      {msg && <p className={`push-n${msg.tone === 'bad' ? ' bad' : ' ok'}`}>{msg.text}</p>}
    </div>
  );
}
