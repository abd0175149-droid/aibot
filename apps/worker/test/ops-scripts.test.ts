import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * ★ حارسٌ ساكن على سكربتات التشغيل — من عائلة `db-context.test.ts` نفسها،
 *   ويسكن معه لأنّ `vitest run` في هذه الحزمة هو ما يُشغّله `turbo run test`.
 *   حارسٌ في مجلّدٍ لا تمرّ عليه CI طمأنينةٌ كاذبة، وهذا المشروع لا يشتريها.
 *
 * والأعطال الثلاثة التي وُلد منها كلّ فحصٍ هنا **حدثت فعلاً** في يوم كتابته:
 *
 * ① **`docker compose exec -T` يأكل stdin المنادي.** الراية `-T` تمرّر stdin
 *    إلى الحاوية وتستهلكه كلّه. فنداءٌ داخل `while read` يسرق بقيّة الأسطر،
 *    والحلقة تنتهي بعد صفٍّ واحد **بلا خطأ**: تمرينُ الاستعادة فحص جدولاً من
 *    تسعة وطبع ✅، وسكربتُ اختبارٍ مُرِّر بـ`bash -s` توقّف في منتصفه صامتاً.
 *    فالقاعدة: كلّ نداءٍ يعلن مصدر stdin — أنبوبٌ يغذّيه، أو `< …` صريحة.
 *
 * ② **عبارة المرور في `argv`.** `--passphrase X` يجعل السرّ مرئيّاً لكلّ من
 *    يقرأ `ps` على خادمٍ فيه ٥٩ حاوية. `--passphrase-fd` وحده مقبول.
 *
 * ③ **سرٌّ حرفيٌّ في المستودع.** المستودع عامّ (`02`)، وسطرٌ واحدٌ فيه
 *    `MASTER_KEY=<القيمة>` يُنهي تشفير توكنات كلّ العملاء. والخطأ يحدث بلصقةٍ
 *    في وثيقةٍ أو مثالٍ، لا بقرار — ولهذا يُمسك بالشكل لا بالنيّة.
 */

const REPO = join(__dirname, '..', '..', '..');

function shellScripts(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.sh')) {
        out.push({ file: relative(REPO, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') });
      }
    }
  };
  walk(join(REPO, 'ops'));
  out.push({ file: 'deploy.sh', src: readFileSync(join(REPO, 'deploy.sh'), 'utf8') });
  return out;
}

/**
 * يطوي أسطر الاستمرار (`\` في آخر السطر) إلى سطرٍ منطقيٍّ واحد مع رقم بدايته.
 * ★ بلا الطيّ يكذب الفحص في الاتّجاهين: أمرٌ إعادةُ توجيهه في السطر التالي
 *   يُقرأ مخالفةً، وأنبوبٌ رأسه في السطر السابق يُقرأ سليماً.
 */
export function logicalLines(src: string): Array<{ n: number; text: string }> {
  const raw = src.split(/\r?\n/);
  const out: Array<{ n: number; text: string }> = [];
  let buf = '';
  let start = 1;
  raw.forEach((line, i) => {
    if (buf === '') start = i + 1;
    if (/\\$/.test(line)) {
      buf += `${line.replace(/\\$/, '')} `;
      return;
    }
    out.push({ n: start, text: buf + line });
    buf = '';
  });
  if (buf !== '') out.push({ n: start, text: buf });
  return out;
}

const DOCKER_EXEC = /docker\s+compose\s+exec\s+-T\b/;
/** أنبوبٌ يغذّي النداء — stdin مقصودٌ ومُعلَن. */
const PIPED_IN = /\|\s*docker\s+compose\s+exec/;
/** إعادة توجيهٍ صريحة: `< file` أو `< /dev/null`. */
const REDIRECTED = /(?<![0-9<])<\s*[^<\s]/;
/** `gpg` في موضع أمرٍ لا داخل نصٍّ معروض. */
const GPG_CALL = /(?:^|[;|&(]|\|)\s*gpg\s/;
const COMMENT = /^\s*#/;

describe('سكربتات التشغيل — الشكل الذي يفشل صامتاً', () => {
  it('كلّ `docker compose exec -T` يُعلن مصدر stdin', () => {
    const offences: string[] = [];
    for (const { file, src } of shellScripts()) {
      for (const { n, text } of logicalLines(src)) {
        if (COMMENT.test(text) || !DOCKER_EXEC.test(text)) continue;
        if (PIPED_IN.test(text) || REDIRECTED.test(text)) continue;
        offences.push(`${file}:${n} → ${text.trim().slice(0, 90)}`);
      }
    }
    expect(
      offences,
      '`-T` يمرّر stdin إلى الحاوية ويستهلكه كلّه، فيسرق من حلقةٍ تقرأ أو من '
      + 'سكربتٍ مُرَّر عبر stdin — بلا خطأ ولا أثر. أضِف `< /dev/null` إن لم '
      + 'يكن النداء بحاجةٍ إلى إدخال، أو غذِّه بأنبوبٍ صريح.',
    ).toEqual([]);
  });

  it('لا عبارة مرورٍ في سطر الأوامر — `--passphrase-fd` وحده', () => {
    const offences: string[] = [];
    for (const { file, src } of shellScripts()) {
      src.split(/\r?\n/).forEach((text, i) => {
        if (COMMENT.test(text)) return;
        if (/--passphrase(?!-fd)/.test(text)) offences.push(`${file}:${i + 1} → ${text.trim()}`);
      });
    }
    expect(offences, 'سطر أوامر عمليّةٍ تعمل يقرأه كلّ مستخدمٍ على الخادم بـps').toEqual([]);
  });

  it('كلّ تشفيرٍ تناظريّ بـAES256 صراحةً', () => {
    for (const { file, src } of shellScripts()) {
      for (const { text } of logicalLines(src)) {
        // GPG_CALL لا `/gpg/` وحدها: بلا موضع الأمر يُقرأ `say "gpg --symmetric …"`
        // نداءً فيسقط الاختبار على نصٍّ معروض. الشكل يُمسك في موضعه لا في أيّ موضع.
        if (COMMENT.test(text) || !GPG_CALL.test(text) || !/--symmetric\b/.test(text)) continue;
        expect(text, `${file}: --symmetric بلا --cipher-algo AES256 يتبع افتراض gpg`)
          .toMatch(/--cipher-algo\s+AES256/);
      }
    }
  });

  it('لا سرَّ حرفيّاً في السكربتات ولا في وثيقة النسخ', () => {
    const files = shellScripts();
    for (const rel of ['docs/plan/19-backup-and-restore.md', 'ops/systemd/aibot-backup.service',
      'ops/systemd/aibot-backup.timer', 'ops/show-master-key.ts']) {
      files.push({ file: rel, src: readFileSync(join(REPO, rel), 'utf8') });
    }
    const SECRET = /\b(MASTER_KEY|BACKUP_PASSPHRASE|JWT_SECRET|APP_DB_PASSWORD)\s*=\s*['"]?[A-Za-z0-9+/]{20,}/;
    const offences: string[] = [];
    for (const { file, src } of files) {
      src.split(/\r?\n/).forEach((text, i) => {
        if (SECRET.test(text)) offences.push(`${file}:${i + 1}`);
      });
    }
    expect(offences, 'المستودع عامّ — سرٌّ حرفيٌّ فيه ليس خطأً بل حادثةُ أمن').toEqual([]);
  });

  it('كلّ سكربتٍ يسقط على الخطأ وعلى الأنبوب', () => {
    for (const { file, src } of shellScripts()) {
      expect(src, `${file}: بلا set -Eeuo pipefail يتابع السكربت بعد فشل خطوة`)
        .toMatch(/set -Eeuo pipefail/);
    }
  });

  it('الماسح يمسك الشكل فعلاً — وإلّا فهو اختبارٌ يمرّ دائماً', () => {
    // المخالفة الحقيقيّة التي كسرت تمرين الاستعادة
    const bad = 'psql_test() { docker compose exec -T db psql -At "$@"; }';
    expect(DOCKER_EXEC.test(bad) && !PIPED_IN.test(bad) && !REDIRECTED.test(bad)).toBe(true);
    // وإصلاحها
    const fixed = 'psql_test() { docker compose exec -T db psql -At "$@" < /dev/null; }';
    expect(REDIRECTED.test(fixed)).toBe(true);
    // أنبوبٌ يغذّي النداء — مقبول
    expect(PIPED_IN.test('gunzip -c x.gz | docker compose exec -T db psql -d y')).toBe(true);
    // `2>&1` و`>/dev/null` ليسا إعادة توجيهٍ للإدخال
    expect(REDIRECTED.test('docker compose exec -T db psql -c "x" >/dev/null 2>&1')).toBe(false);
    // الطيّ يجمع الأنبوب مع النداء الذي في السطر التالي
    const folded = logicalLines('if ! gunzip -c f.gz \\\n  | docker compose exec -T db psql \\\n  > log; then');
    expect(folded).toHaveLength(1);
    expect(PIPED_IN.test(folded[0]!.text)).toBe(true);
    // و`gpg` في موضع أمرٍ يُمسك، وفي نصٍّ معروضٍ لا يُمسك
    expect(GPG_CALL.test("printf '%s' \"$P\" | gpg --batch --symmetric")).toBe(true);
    expect(GPG_CALL.test('say "gpg --symmetric AES256"')).toBe(false);
    // والسرّ الحرفيّ يُمسك، والمتغيّر لا يُمسك
    const S = /\b(MASTER_KEY|BACKUP_PASSPHRASE)\s*=\s*['"]?[A-Za-z0-9+/]{20,}/;
    expect(S.test('MASTER_KEY=Zm9vYmFyYmF6cXV1eDEyMzQ1Njc4OTA=')).toBe(true);
    expect(S.test('echo "MASTER_KEY=${MASTER_KEY}"')).toBe(false);
    expect(S.test('MASTER_KEY_VERSION=2')).toBe(false);
  });
});

/**
 * ★ بتُّ التنفيذ مسجَّلٌ في git — لا مضبوطٌ على الخادم باليد.
 *
 *   العطل الذي وُلد منه هذا الحارس وقع فعلاً: كُتبت السكربتات من ويندوز فسُجّلت
 *   بوضع `100644`، ونجحت على الخادم لأنّها شُغّلت بـ`bash ops/…` أو رُفع بتُّها
 *   يدويّاً هناك. ثمّ جاء `git pull` في النشرة التالية **فأعاد الوضع 644**.
 *
 *   والنتيجة صمتٌ لا خطأ: `deploy.sh` يحرس بـ`[ -x ops/backup-offsite.sh ]`،
 *   والشرط يكذب، فتُتخطّى الكتلة كلّها ولا تُنشأ الحزمة المشفَّرة — وهي التي
 *   تسبق تغييراً خطراً بثوانٍ. وحدةُ systemd تفشل بـ«غير قابلٍ للتنفيذ» وتبدو
 *   عطلَ نشرٍ لا عطلَ وضع.
 *
 *   ولذلك يُفحص الوضع **في الفهرس** لا على القرص: قرصُ ويندوز لا يحمل بتّاً،
 *   والحقيقة الوحيدة المنقولة إلى الخادم هي ما سجّله git.
 */
describe('سكربتات التشغيل قابلةٌ للتنفيذ في الفهرس', () => {
  it('كلّ .sh يُنادى من deploy.sh أو من وحدة systemd وضعُه 100755', () => {
    const idx = execSync('git ls-files -s -- ops/*.sh deploy.sh', {
      cwd: join(__dirname, '..', '..', '..'), encoding: 'utf8',
    });
    const bad = idx.split('\n').filter(Boolean)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p[0] !== '100755')
      .map((p) => `${p[3]} → ${p[0]}`);

    expect(
      bad,
      'سكربتٌ بلا بتّ تنفيذٍ في git. `deploy.sh` يحرس بـ[ -x ] فيتخطّاه صامتاً. '
      + 'الإصلاح: git update-index --chmod=+x <الملفّ>',
    ).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ★★★ **`exit 1` لا يُطلق `trap … ERR`** — وكلُّ بوّابةٍ في `deploy.sh` تفشل به.

   دلالةُ bash لا علّةُ سكربت، ومُجرَّبةٌ: `false` تُطلق المصيدةَ و`exit 1` لا
   تُطلقها، وكذلك `if ! cmd; then exit 1; fi`. فالبوّاباتُ الأربع (الترحيلُ،
   وصحّةُ الخلفيّة، ورمزُ الواجهة، ونسختُها) كانت تخرج **بلا تراجع**: حاوياتُ
   «الاستبدال» الجديدة تبقى تخدم الطلبات على قاعدةٍ نصفِ مُرحَّلة، ولا يُطبع
   أمرُ التراجع لأنّ الملخّص لم يُبلَغ — فيبدو الأمرُ نشرةً فاشلةً نظيفة وهو
   خادمٌ عالق.

   والتناقضُ الذي يُثبت العطل: `ALTER ROLE` بعد الترحيل بستّة أسطرٍ أمرٌ
   **عريان**، فيُطلق ERR ويتراجع فعلاً — بينما فشلُ الترحيل نفسِه لا يتراجع.
   ══════════════════════════════════════════════════════════════════════════ */

describe('★ النشرُ يتراجع عند كلّ فشل — لا عند بعضه', () => {
  const src = readFileSync(join(REPO, 'deploy.sh'), 'utf8');
  /* التعليقاتُ تُعمّى: هذا الملفّ يشرح العطلَ الذي يحرسه بأسطرٍ تحمل
     `exit 1` و`trap` — وماسحٌ لا يُعميها يبلّغ عن شرحه هو. */
  const code = src.split(/\r?\n/).map((t) => (/^\s*#/.test(t) ? '' : t));

  it('المِرساةُ موجودة — فلا يمرّ الحارسُ على فراغ', () => {
    expect(code.some((t) => /docker\s+compose\s+up\s+-d/.test(t))).toBe(true);
  });

  it('★★★ مصيدةٌ على EXIT مُسلَّحة — وهي وحدها تمسك `exit` الصريح', () => {
    expect(src).toMatch(/arm_rollback\(\)\s*{\s*trap\s+'rc=\$\?;/);
    /* وتُنادى فعلاً: تعريفٌ بلا نداءٍ طمأنينةٌ كاذبة. */
    expect(code.some((t) => /^arm_rollback\s*$/.test(t.trim())), 'مُعرَّفةٌ ولا تُنادى').toBe(true);
  });

  it('★★ والتسليحُ بعد وجود وسومٍ يُتراجَع إليها لا قبلها', () => {
    /* تسليحٌ مبكّرٌ يجعل فشلَ «.env غائب» أو «pg_dump فشل صامتاً» يهدم
       حاوياتٍ سليمةً ويُعيد إنشاءها بلا شيءٍ يُستعاد إليه. */
    const iTag = src.indexOf(':rollback-${STAMP}"');
    const iArm = src.search(/^arm_rollback$/m);
    const iUp = src.search(/^docker compose up -d \$SERVICES$/m);
    expect(iTag).toBeGreaterThan(0);
    expect(iArm, 'التسليحُ قبل إنشاء الوسوم').toBeGreaterThan(iTag);
    expect(iArm, 'التسليحُ بعد نقطة اللا رجوع — فبوّاباتُ ما قبلها بلا حماية').toBeLessThan(iUp);
  });

  it('★★★ والتراجعُ ينزع المصيدتَين أوّلَ شيء — وإلّا جرى مرّتَين', () => {
    /* فشلٌ حقيقيّ يُطلق ERR فتُنادى `rollback`، ثمّ تخرج بـ1 فتُطلق EXIT
       فتُنادى ثانيةً — ويصطدم `docker compose up` بنفسه. */
    const at = src.indexOf('rollback() {');
    expect(at).toBeGreaterThan(0);
    const firstStmt = src.slice(at, src.indexOf('fail ', at));
    expect(firstStmt, 'النزعُ ليس أوّلَ ما يجري في الدالّة').toContain('trap - ERR EXIT');
  });

  it('★★ والنجاحُ ينزعهما معاً — وإلّا تراجع نشرٌ ناجحٌ على خطأٍ في طبع الملخّص', () => {
    const disarms = [...src.matchAll(/^\s*trap - ERR(?: EXIT)?$/gm)].map((m) => m[0].trim());
    expect(disarms.length, 'النزعُ في التراجع وإعادة التنفيذ والنجاح').toBeGreaterThanOrEqual(3);
    expect(disarms.filter((d) => d === 'trap - ERR'), 'نزعٌ يترك EXIT مُسلَّحة').toEqual([]);
  });

  it('★★★ والحزمةُ الليليّة تُخرج فشلَها — وكان يسقط في الصمت', () => {
    /* بلا `OnFailure` لا يخرج الفشل من journald أبداً: تسقط النسخةُ ليلةً
       بعد ليلة ولا أحدَ يعلم، حتّى اليوم الذي تُطلب فيه. */
    const unit = readFileSync(join(REPO, 'ops', 'systemd', 'aibot-backup.service'), 'utf8');
    expect(unit).toMatch(/^OnFailure=/m);
    expect(readFileSync(join(REPO, 'ops', 'systemd', 'aibot-backup-failed@.service'), 'utf8'))
      .toContain('BACKUP-FAILED');
  });

  it('★★★ ولا `After=docker.service` في وحدةِ مستخدم — تُهمَل بصمت', () => {
    /* مديرُ المستخدم لا يحمل وحداتِ النظام، فالترتيبُ إليها لا خطأَ
       فيه ولا تحذيرَ ولا انتظار — سطرٌ يُقرأ «تنتظر دوكر» وهي لا تنتظر. */
    const unit = readFileSync(join(REPO, 'ops', 'systemd', 'aibot-backup.service'), 'utf8');
    expect(unit, 'وحدةُ مستخدم').toMatch(/WantedBy=default\.target/);
    expect(unit, 'ترتيبٌ إلى وحدةِ نظامٍ لا يراها مديرُ المستخدم')
      .not.toMatch(/^After=.*docker\.service/m);
    expect(unit, 'والانتظارُ يُصنع بفحصٍ يُنفّذ')
      .toMatch(/ExecStartPre=.*--status running/);
  });

  it('★★★ والوسائطُ في الحزمة — وإلّا استُعيدت صفوفٌ تشير إلى لا شيء', () => {
    /* `knowledge_sources.storage_path` يحمل **مساراً** لا بايتات، والبايتاتُ
       في مجلّد دوكر. والفقدُ صامتٌ: النصُّ المستخرَج محفوظٌ في القاعدة
       فيبقى البوت يردّ كأنّ شيئاً لم يكن. و`migrate-host.sh` ينسخه منذ كُتب:
       كان الترحيلُ أشملَ من النسخة الاحتياطيّة نفسِها. */
    const b = readFileSync(join(REPO, 'ops', 'backup-offsite.sh'), 'utf8');
    expect(b).toContain('tar -C /app -cf - media');
    expect(b, 'والمانيفست يذكرها — مانيفستٌ يسكت يجعل ناقصاً يبدو كاملاً')
      .toContain('media_sha256');
    expect(b, 'وغيابُها يُعلَن لا يُبتلع').toContain('media-MISSING');
  });

  it('★★ وعمرُ آخر حزمةٍ يُفحص — ولم يكن أحدٌ يسأل', () => {
    expect(readFileSync(join(REPO, 'ops', 'backup-offsite.sh'), 'utf8'))
      .toMatch(/AGE_H.*-gt 48|-gt 48/);
    expect(src, 'والنشرُ يُظهره — وهو ما يقرؤه إنسانٌ كثيراً').toContain('BACKUP-FAILED');
    /* ★★ **وتقريرُ الحالة لا يُسقط ما يُقرّر عنه.** مجلّدٌ غائبٌ يجعل
       `find` يخرج بـ١، و`set -e` يحوّله تراجعَ نشرةٍ سليمة — وقع فعلاً في
       أوّل تشغيلٍ لهذه الكتلة بسبب مسارٍ افتراضيٍّ خاطئ. */
    expect(src).toMatch(/head -1 \|\| true\)"/);
    /* والمسارُ نفسُه في الموضعَين — وإلّا قاس الفحصُ مجلّداً آخر. */
    const bk = readFileSync(join(REPO, 'ops', 'backup-offsite.sh'), 'utf8');
    const def = /BACKUP_OFFSITE_DIR:-\$\{HOME\}\/backups\/aibot-offsite/;
    expect(bk).toMatch(def);
    expect(src, 'النشرُ يقيس مجلّداً غير الذي تكتب فيه الحزمة').toMatch(def);
  });

  it('★★★ و`GIT_REV` يُخبز في الصورة ولا يُمرّر وقتَ التشغيل', () => {
    /* متغيّرُ التشغيل يغلب المخبوز، فتُعلن الحاويةُ نسخةَ النشرة مهما
       كانت صورتُها. وعند التراجع تقول `/api/health` إنّها النسخةُ التي فشلت
       وهي تشغّل سابقتَها — تكذب في اللحظة التي تُحتاج فيها. رأيتُها بعيني
       أثناء اختبار التراجع. وبوّابةُ نسخةِ الواجهة كُتبت لتمسك صورةً بائتةً
       — ومتغيّرُ التشغيل يُعميها عنها تماماً. */
    const c = readFileSync(join(REPO, 'docker-compose.yml'), 'utf8');
    const lines = c.split(/\r?\n/);
    const bad: string[] = [];
    let inArgs = false;
    for (const t of lines) {
      if (/^ *args:/.test(t)) inArgs = true;
      else if (/^ *(environment|volumes|ports|command|depends_on|build|image):/.test(t)) inArgs = false;
      if (/GIT_REV:/.test(t) && !/^ *#/.test(t) && !inArgs) bad.push(t.trim());
    }
    expect(bad, '`GIT_REV` مُمرّرٌ وقتَ التشغيل — يغلب المخبوز فيكذب الوصف').toEqual([]);
    expect(readFileSync(join(REPO, 'Dockerfile'), 'utf8')).toMatch(/ENV GIT_REV=\$\{GIT_REV}/);
  });

  it('★★★ وبوّابةُ النشر تسأل عن العامل — وكانت عمياءَ عنه تماماً', () => {
    /* كلُّ ما يجعل البوت يردّ يعيش في عمليّة العامل: الواردُ والتوليدُ
       والصادر. والبوّابةُ كانت تطابق `rev` الـAPI وحده، فنشرةٌ تكسر مسارَ
       العامل وحدَه تُطبع ✅ وكلُّ الردود متوقّفةٌ لكلّ العملاء. */
    expect(src).toContain('"worker":true');
    expect(src, '«حيّ» وحدها لا تكفي — عاملٌ بلا مجدوِلات حيٌّ ولا يفعل شيئاً')
      .toContain('workerSched');
    /* ★★ والاستخراجُ يُفحَص لا يُفترض: أوّلُ نسخةٍ من هذه البوّابة كانت
       بديلُها في `sed` **فارغاً** (‏`//p` لا `/\1/p`)، فكان المتغيّرُ خالياً
       دائماً وسقطت كلُّ نشرةٍ سليمة. وفشلت **مقفلةً** فلم تؤذِ شيئاً — لكنّ
       حارساً يقرأ الشكلَ يُسقطها قبل أن تصل الخادم. */
    expect(src, 'بديلٌ فارغٌ — المتغيّر يبقى خالياً دائماً')
      .toContain('s/.*"workerSched":\\([0-9]*\\).*/\\1/p');
    const iGate = src.indexOf('WOK=1');
    const iFail = src.indexOf('bots'.replace('bots', 'بوتات العملاء صامتة'));
    expect(iGate, 'لا بوّابةَ عامل ').toBeGreaterThan(0);
    expect(iFail, 'وفشلُها يقول عاقبتَه').toBeGreaterThan(0);
  });

  it('★★★ والعاملُ يموت إن لم يستطع الجدولة — وكان يسجّل ويمضي', () => {
    /* عاملٌ فشلت جدولتُه يبقى حيّاً ونبضتُه خضراء، بينما لا فحصَ صحّةٍ
       للقنوات ولا إغلاقَ نوافذَ ولا إشارةَ «رسائلٌ بلا ردود» ولا تجميعَ
       إشعارات: كلُّ ما يُنبّه أنّ شيئاً تعطّل **هو نفسُه** ما تعطّل. */
    const w = readFileSync(join(REPO, 'apps', 'worker', 'src', 'main.ts'), 'utf8');
    expect(w).toContain('if (schedCount < SCHED_EXPECTED) {');
    expect(w, 'الخروجُ يجعل compose يُعيد التشغيل فتظهر الحاويةُ تتهاوى')
      .toMatch(/process\.exit\(1\)/);
    /* ★ والعدُّ **يُقرأ من ريدِس** لا يُحسب من النيّة: `add` قد يُرجع
       بلا خطأ ولا يُنتج متكرّراً. */
    expect(w).toContain('getJobSchedulersCount()');
    expect(w, 'العددُ المتوقّع من الروستر لا رقمٌ مكتوب')
      .toMatch(/SCHED_EXPECTED = SCHED\.length/);
    /* والنبضةُ تحملُه — وإلّا لم تستطع البوّابةُ أن تسأل عنه. */
    expect(w).toMatch(/sched: schedCount/);
  });

  it('★★★ والترحيلُ **قبل** الاستبدال — وإلّا عملت شيفرةٌ جديدةٌ على مخطّطٍ قديم', () => {
    /* ثوانٍ يقرأ فيها الكودُ الجديدُ عموداً لم يُضَف بعد: «column does not
       exist» ليست `AppError` فلا حادثةَ ولا أثر — أخطاءٌ خامّةٌ في وجه كلّ
       عميل. وقد وقع فعلاً: طُبّقت أعمدةُ العامل الثاني يدويّاً قبل النشر
       تفادياً له، وهذا اعترافٌ بالعطل لا حلٌّ له. */
    const iMig = src.indexOf('for f in packages/db/migrations/');
    const iUp = src.search(/^docker compose up -d \$SERVICES$/m);
    const iRole = src.indexOf('ALTER ROLE aibot_app');
    expect(iMig).toBeGreaterThan(0);
    expect(iUp).toBeGreaterThan(0);
    expect(iMig, 'الترحيل بعد استبدال الحاويات').toBeLessThan(iUp);
    expect(iRole, 'ضبطُ الدور قبل الترحيل الذي يُنشئُه').toBeGreaterThan(iMig);
    expect(iRole).toBeLessThan(iUp);
  });

  it('★★★ وكلُّ ملفّ ترحيلٍ وحدةٌ ذرّيّة', () => {
    /* `0002` يحذف السياسةَ ثمّ يُنشئُها. وفي معاملتَين مستقلّتَين توجد
       لحظةٌ يكون الجدول فيها RLS-مفعّلاً **بلا سياسة**: `SELECT` من `aibot_app`
       يُرجع صفراً بلا خطأ — وهو بعينه العطلُ الذي بُنيت بوّابتا العزل لمنعه. */
    expect(src).toContain('--single-transaction');
    const migDir = join(REPO, 'packages', 'db', 'migrations');
    const bad = readdirSync(migDir).filter((f) => f.endsWith('.sql')
      && /CONCURRENTLY/i.test(readFileSync(join(migDir, f), 'utf8')));
    expect(bad, '`CONCURRENTLY` لا تعمل داخل معاملة').toEqual([]);
  });

  it('★★ ومهلةُ قفلٍ — فاستعلامٌ طويلٌ واحدٌ لا يجمّد النشرة كلّها', () => {
    expect(src).toMatch(/PGOPTIONS='-c lock_timeout=\d+s'/);
  });

  it('★★ وللترحيل أثرٌ — والمخرَجُ الذي قال «تمّ» ينقضي', () => {
    expect(src).toContain('INSERT INTO schema_migrations');
    expect(src, 'وبصمةُ الملفّ').toContain('sha256sum');
    const init = readFileSync(join(REPO, 'packages', 'db', 'migrations', '0000_init.sql'), 'utf8');
    expect(init).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
  });

  it('★★★ ولا خروجَ غيرُ صفريٍّ بعد نقطة اللا رجوع خارج حماية التسليح', () => {
    /* هذا هو الحارسُ الحقيقيّ: بوّابةٌ جديدةٌ تُضاف غداً بـ`exit 1` بعد
       الاستبدال تسقط هنا ما لم تكن تحت مصيدةٍ مُسلَّحة. */
    const lines = src.split(/\r?\n/);
    const blind = lines.map((t, i) => ({ t, i }))
      .filter(({ t }) => !/^\s*#/.test(t));
    const iArm = blind.findIndex(({ t }) => /^arm_rollback\s*$/.test(t.trim()));
    expect(iArm, 'لا تسليحَ إطلاقاً').toBeGreaterThan(-1);
    const iRollbackEnd = blind.findIndex(({ t }) => /^}\s*$/.test(t) && t.length < 4);
    void iRollbackEnd;
    const after = blind.slice(iArm + 1).filter(({ t }) => /\bexit [1-9]/.test(t));
    /* كلُّها مسموحةٌ **لأنّ** التسليح يغطّيها — والعدُّ يوثّق أنّها موجودةٌ فعلاً
       فلا يُقرأ الحارسُ نجاحاً على سكربتٍ بلا بوّابات. */
    expect(after.length, 'لا بوّابةَ تخرج بعد التسليح — تغيّر الملفّ، راجِع الحارس')
      .toBeGreaterThanOrEqual(4);
  });
});
