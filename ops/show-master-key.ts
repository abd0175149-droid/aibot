/**
 * إظهار `MASTER_KEY` مرّةً واحدة — لتنسخه إلى مدير كلمات المرور.
 *
 * ★ لماذا يستحقّ هذا سكربتاً بذاته، وهو «سطرٌ في .env»:
 *   لأنّ المطلوب ليس قراءةَ السطر بل **إثباتُ أنّ ما تنسخه هو المفتاح
 *   العامل**. `cat .env | grep MASTER_KEY` يعطيك نصّاً؛ وقد يكون منسوخاً
 *   من مثالٍ قديم، أو فيه مسافةٌ في آخره، أو مفتاحَ إصدارٍ سابقٍ بعد تدوير.
 *   ولا تكتشف الفرق إلّا يوم الاستعادة — حين لا يفتح شيئاً.
 *   فهذا السكربت يأخذ توكن قناةٍ حقيقيّاً من القاعدة **ويفكّه بالمفتاح**،
 *   ثمّ يطبعه. ما يُطبع هنا ليس سطراً من ملفّ بل مفتاحٌ جُرِّب.
 *
 * ★ وما يعنيه فقدانه — بالضبط لا تقريباً:
 *   توكنات واتساب لكلّ عملائك مشفَّرةٌ به (AES-256-GCM، `packages/crypto`).
 *   فقدانه ليس «تعبٌ في الاسترجاع»: هو **فقدانٌ نهائيّ** لقدرة كلّ بوتٍ على
 *   الإرسال، ولا يُصلحه وجود نسخةٍ احتياطيّة — لأنّ النسخة تحمل نفس الصفوف
 *   المشفَّرة بنفس المفتاح الضائع. العلاج الوحيد: أن يُصدر كلّ عميلٍ توكناً
 *   جديداً من حساب ميتا عنده، ويُعاد إدخاله يدويّاً. وهذا محادثةٌ مع كلّ
 *   عميلٍ تشرح فيها أنّك أضعت أسراره.
 *
 * 🔴 ثلاثة محرَّماتٍ على هذا المخرَج:
 *   ① لا يُوجَّه إلى ملفٍّ داخل المستودع  ② ولا يُلصق في رسالة كوميت أو تذكرة
 *   ③ ولا يُرسل إلى أيّ خدمة — لا دردشةٍ، ولا لصّاقةٍ، ولا بريد.
 *   المفتاح يُنسخ من الشاشة إلى مدير كلمات المرور، ثمّ تُغلق الشاشة.
 *
 * الاستعمال (على الخادم):
 *   docker compose run --rm --no-deps -v "$HOME/aibot/ops:/app/ops:ro" \
 *     api node --import tsx ops/show-master-key.ts
 *
 *   ALLOW_NO_TTY=1  لازمٌ إن لم تكن الطرفيّة تفاعليّة (سكربت، أنبوب، ssh).
 */
import {
  getDb, closeDb, withPlatform, tenantChannels, tenants, isNotNull, eq,
} from '../packages/db/src/index';
import { open as openSealed, currentKeyVersion } from '../packages/crypto/src/index';

function line(): void {
  console.log('─'.repeat(64));
}

async function main(): Promise<void> {
  const key = (process.env.MASTER_KEY ?? '').trim();
  if (!key) {
    console.error('فشل: MASTER_KEY غير مضبوط في بيئة هذه العمليّة.');
    console.error('  إن شغّلته بـ`--no-deps` فتأكّد أنّ compose يقرأ .env — أو مرّره بـ-e.');
    process.exit(1);
  }

  const bytes = Buffer.from(key, 'base64').length;
  if (bytes !== 32) {
    console.error(`فشل: المفتاح ${bytes} بايت بعد فكّ base64 — والمطلوب ٣٢ بالضبط.`);
    console.error('  هذا ليس تحذيراً شكليّاً: مفتاحٌ بطولٍ آخر لا يُقبل في aes-256-gcm');
    console.error('  إطلاقاً، فالمنصّة لا تُقلع به أصلاً. ما في .env ليس المفتاح العامل.');
    process.exit(1);
  }

  /* 🔴 الحاجز الوحيد بين «أظهرتُه لأنسخه» و«أظهرتُه فدخل سجلّ نشرٍ يقرأه
     الجميع». طرفيّةٌ غير تفاعليّة تعني أنّ المخرَج ذاهبٌ إلى مكانٍ يبقى. */
  if (!process.stdout.isTTY && process.env.ALLOW_NO_TTY !== '1') {
    console.error('فشل: المخرَج ليس طرفيّةً تفاعليّة — وقد يكون ملفّاً أو سجلّاً يبقى.');
    console.error('  أخطر سرٍّ في المنصّة لا يُطبع في مكانٍ لم تقصده. إن كنت قاصداً:');
    console.error('    ALLOW_NO_TTY=1 … ops/show-master-key.ts');
    process.exit(1);
  }

  // ── الإثبات: هل يفتح هذا المفتاح توكناً حقيقيّاً؟ ──────────────
  const db = getDb();
  const proof = await withPlatform(
    db,
    'إظهار المفتاح الرئيس للمشغّل مع إثبات أنّه يفكّ توكناً قائماً',
    async (tx) => {
      const rows = await tx
        .select({
          id: tenantChannels.id,
          enc: tenantChannels.tokenEnc,
          v: tenantChannels.keyVersion,
          tenant: tenants.name,
        })
        .from(tenantChannels)
        .leftJoin(tenants, eq(tenants.id, tenantChannels.tenantId))
        .where(isNotNull(tenantChannels.tokenEnc))
        .limit(5);
      return rows;
    },
  );

  const tried = proof.length;
  let opened = 0;
  const failures: string[] = [];
  for (const row of proof) {
    try {
      const plain = openSealed(row.enc as string, row.v);
      // ولا تُطبع قيمةُ التوكن ولا بصمتُه — الإثبات أنّه فُتح، لا ما فيه.
      if (plain.length > 0) opened += 1;
    } catch (e) {
      failures.push(`${row.tenant ?? '؟'} (v${row.v}): ${(e as Error).message}`);
    }
  }

  console.log();
  line();
  console.log('  MASTER_KEY — أخطر سرٍّ في المنصّة');
  line();
  console.log(`  الإصدار الحاليّ:   v${currentKeyVersion()}`);
  console.log(`  الطول:            ${bytes} بايت (✔)`);
  if (tried === 0) {
    console.log('  الإثبات:          لا توكنَ مشفَّرٌ في القاعدة بعد — لم يُجرَّب المفتاح.');
    console.log('                    أعِد تشغيل هذا بعد ربط أوّل قناة، فالطول وحده ليس دليلاً.');
  } else if (opened === tried) {
    console.log(`  الإثبات:          فُتحت ${opened}/${tried} من توكنات القنوات بهذا المفتاح (✔)`);
  } else {
    console.log(`  الإثبات:          ✘ فُتحت ${opened}/${tried} فقط`);
    for (const f of failures) console.log(`                    – ${f}`);
    console.log('  ⚠ مفتاحٌ لا يفتح ما في القاعدة ليس المفتاح العامل. لا تنسخه كأنّه هو.');
  }
  line();
  console.log('  انسخ السطر التالي — يُطبع مرّةً واحدة ولا يُسجَّل في أيّ مكان:');
  console.log();
  // حرفٌ واحدٌ في سطرٍ واحد: ليُنسخ بنقرةٍ مزدوجة، وليُنقَّح بسطرٍ واحد لو مرّ بأنبوب.
  console.log(key);
  console.log();
  line();
  console.log('  ما تفعله الآن — خمس دقائق، مرّةً واحدة في عمر المنصّة:');
  console.log('   ① افتح مدير كلمات المرور (Bitwarden · 1Password · KeePassXC).');
  console.log('   ② سجلٌّ جديد باسم: AiBot MASTER_KEY (prod · aibot.masaros.net)');
  console.log('   ③ الصق المفتاح، وفي الملاحظات: التاريخ، والإصدار v' + currentKeyVersion() + '.');
  console.log('   ④ وفي نفس السجلّ — أو بجانبه — BACKUP_PASSPHRASE من');
  console.log('      ~/.config/aibot/backup.env. بلا الاثنين لا تُفكّ حزمةٌ ولا تُستعمل.');
  console.log('   ⑤ أغلق هذه الطرفيّة، ثمّ امسح سجلّها إن كان يُحفظ.');
  line();
  console.log('  ولماذا خارج هذا الجهاز تحديداً:');
  console.log('   المفتاح الآن في .env على اللابتوب الذي يشغّل المنصّة، والنسخ');
  console.log('   الاحتياطيّة على نفس القرص. فعطلٌ واحدٌ في قرصٍ واحد يأخذ الثلاثة');
  console.log('   معاً: البيانات، والمفتاح، والنسخة. وحفظه في مكانٍ ثانٍ يقطع هذا');
  console.log('   الارتباط — وهو أرخص إجراءٍ في الخطّة كلّها وأعلاها أثراً.');
  line();
  console.log();

  await closeDb();
}

main().catch(async (e) => {
  console.error('فشل:', (e as Error).message);
  await closeDb().catch(() => {});
  process.exit(1);
});
